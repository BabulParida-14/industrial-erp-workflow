const request = require('supertest');
const app = require('../src/server');
const db = require('../src/config/db');

describe('PERN ERP Automated Verification Suite', () => {
  let adminToken;
  let salesToken;

  beforeAll(async () => {
    // Obtain tokens
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@erp.com', password: 'Password@123' });
    adminToken = adminRes.body.token;

    const salesRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sales@erp.com', password: 'Password@123' });
    salesToken = salesRes.body.token;
  });

  afterAll(async () => {
    await db.pool.end();
  });

  // TEST 1: Quotation total calculation
  test('Test 1: Quotation grand total and line amount calculated accurately on backend', async () => {
    // Product 1: base_price = 18500.00
    // Qty = 2, UnitPrice = 18500, Discount = 10%, GST = 18%
    // Base = 37,000. Disc = 33,300. GST 18% = 5,994. Line Total = 39,294.00
    const res = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        enquiry_id: 1,
        valid_until: '2026-12-31',
        items: [
          { product_id: 1, quantity: 2, unit_price: 18500, discount_pct: 10, gst_pct: 18 }
        ]
      });

    expect(res.statusCode).toBe(201);
    expect(parseFloat(res.body.grand_total)).toBe(39294.00);
  });

  // TEST 2: Rejected/Draft quotation cannot create Sales Order
  test('Test 2: Rejected and Draft quotations cannot create a Sales Order', async () => {
    // Create quotation (default is DRAFT)
    const quoRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        enquiry_id: 1,
        valid_until: '2026-12-31',
        items: [{ product_id: 1, quantity: 1, unit_price: 18500, discount_pct: 0, gst_pct: 18 }]
      });
    const quoId = quoRes.body.id;

    // Try converting DRAFT
    const draftConvertRes = await request(app)
      .post(`/api/quotations/${quoId}/convert`)
      .set('Authorization', `Bearer ${salesToken}`);
    expect(draftConvertRes.statusCode).toBe(400);

    // Reject quotation and try again
    await request(app)
      .patch(`/api/quotations/${quoId}/status`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ status: 'REJECTED' });

    const rejectConvertRes = await request(app)
      .post(`/api/quotations/${quoId}/convert`)
      .set('Authorization', `Bearer ${salesToken}`);
    expect(rejectConvertRes.statusCode).toBe(400);
  });

  // TEST 3: Duplicate Sales Orders prevented
  test('Test 3: Cannot generate duplicate Sales Orders for the same quotation', async () => {
    const quoRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        enquiry_id: 1,
        valid_until: '2026-12-31',
        items: [{ product_id: 1, quantity: 1, unit_price: 18500, discount_pct: 0, gst_pct: 18 }]
      });
    const quoId = quoRes.body.id;

    // Set to ACCEPTED
    await request(app)
      .patch(`/api/quotations/${quoId}/status`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ status: 'ACCEPTED' });

    // First conversion: succeeds
    const firstConv = await request(app)
      .post(`/api/quotations/${quoId}/convert`)
      .set('Authorization', `Bearer ${salesToken}`);
    expect(firstConv.statusCode).toBe(201);

    // Duplicate conversion: blocked
    const secondConv = await request(app)
      .post(`/api/quotations/${quoId}/convert`)
      .set('Authorization', `Bearer ${salesToken}`);
    expect(secondConv.statusCode).toBe(400);
  });

  // TEST 4: Cannot reserve more than available inventory
  test('Test 4: Cannot reserve stock exceeding available quantity', async () => {
    // Product 4 has Physical=50, Reserved=0, Available=50. Let's create an order for 90 units.
    const quoRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        enquiry_id: 1,
        valid_until: '2026-12-31',
        items: [{ product_id: 4, quantity: 90, unit_price: 32000, discount_pct: 0, gst_pct: 18 }]
      });

    await request(app)
      .patch(`/api/quotations/${quoRes.body.id}/status`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ status: 'ACCEPTED' });

    const orderRes = await request(app)
      .post(`/api/quotations/${quoRes.body.id}/convert`)
      .set('Authorization', `Bearer ${salesToken}`);

    // Admin tries to confirm 90 units
    const confirmRes = await request(app)
      .post(`/api/sales-orders/${orderRes.body.id}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(confirmRes.statusCode).toBe(400);
    expect(confirmRes.body.error).toContain('Insufficient stock');
  });

  // TEST 5: Unauthorized role cannot perform restricted actions (RBAC)
  test('Test 5: Unauthorized role (Sales User) cannot confirm order or dispatch', async () => {
    const res = await request(app)
      .post('/api/sales-orders/1/confirm')
      .set('Authorization', `Bearer ${salesToken}`);

    expect(res.statusCode).toBe(403);
  });

  // BONUS TEST: Concurrent Inventory Reservation Race Condition
  test('Bonus: Concurrent reservation race condition handles over-allocation atomically', async () => {
    // Reset product 6 inventory to: Physical=100, Reserved=0 (Available=100)
    await db.query('UPDATE inventory SET physical_qty = 100, reserved_qty = 0 WHERE product_id = 6');

    // Create 2 accepted quotations: Order A wants 80, Order B wants 50 (Total 130 > 100)
    const createOrder = async (qty) => {
      const q = await request(app)
        .post('/api/quotations')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({
          enquiry_id: 1,
          valid_until: '2026-12-31',
          items: [{ product_id: 6, quantity: qty, unit_price: 8700, discount_pct: 0, gst_pct: 18 }]
        });
      await request(app)
        .patch(`/api/quotations/${q.body.id}/status`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ status: 'ACCEPTED' });
      const o = await request(app)
        .post(`/api/quotations/${q.body.id}/convert`)
        .set('Authorization', `Bearer ${salesToken}`);
      return o.body.id;
    };

    const orderAId = await createOrder(80);
    const orderBId = await createOrder(50);

    // Fire both confirmation requests simultaneously
    const [resA, resB] = await Promise.all([
      request(app).post(`/api/sales-orders/${orderAId}/confirm`).set('Authorization', `Bearer ${adminToken}`),
      request(app).post(`/api/sales-orders/${orderBId}/confirm`).set('Authorization', `Bearer ${adminToken}`)
    ]);

    // One MUST succeed (200) and one MUST fail (400)
    const statuses = [resA.statusCode, resB.statusCode];
    expect(statuses).toContain(200);
    expect(statuses).toContain(400);

    // Verify DB state remains consistent
    const invCheck = await db.query('SELECT physical_qty, reserved_qty FROM inventory WHERE product_id = 6');
    const { physical_qty, reserved_qty } = invCheck.rows[0];
    expect(reserved_qty).toBeLessThanOrEqual(physical_qty);
  });
});