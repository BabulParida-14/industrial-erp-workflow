// backend/src/routes/api.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const pool = require('../db'); // Adjust path to db.js if located elsewhere

// --- In-line Middleware ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token missing' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'super_secret_erp_jwt_key_2026', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

const authorizeRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }
    next();
  };
};

// --- Helper Functions ---
const calculateItemTotal = (qty, unitPrice, discountPct, gstPct) => {
  const base = qty * unitPrice;
  const discounted = base - (base * (discountPct / 100));
  const finalLine = discounted + (discounted * (gstPct / 100));
  return Number(finalLine.toFixed(2));
};

// ==========================================
// 1. AUTHENTICATION ROUTE
// ==========================================
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userResult.rows[0];
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      process.env.JWT_SECRET || 'super_secret_erp_jwt_key_2026',
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: { id: user.id, full_name: user.name, email: user.email, role: user.role === 'SALES_USER' ? 'SALES' : user.role }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. PRODUCT MASTER & INVENTORY
// ==========================================
router.get('/products', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        p.id, p.product_code, p.product_name, p.category, p.unit, p.base_price,
        COALESCE(i.physical_qty, 0) AS physical_quantity,
        COALESCE(i.reserved_qty, 0) AS reserved_quantity,
        COALESCE(i.physical_qty - i.reserved_qty, 0) AS available_quantity
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      ORDER BY p.id ASC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. CUSTOMER ENQUIRIES
// ==========================================
router.get('/enquiries', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        e.*, 
        c.company_name, c.contact_person, c.mobile, c.email, c.city,
        json_agg(
          json_build_object(
            'item_id', ei.id,
            'product_id', ei.product_id,
            'product_name', p.product_name,
            'product_code', p.product_code,
            'quantity', ei.quantity
          )
        ) AS items
      FROM enquiries e
      JOIN customers c ON e.customer_id = c.id
      JOIN enquiry_items ei ON e.id = ei.enquiry_id
      JOIN products p ON ei.product_id = p.id
      GROUP BY e.id, c.id
      ORDER BY e.id DESC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/enquiries', authenticateToken, authorizeRole('SALES', 'SALES_USER', 'ADMIN'), async (req, res) => {
  const { customer, required_date, notes, items } = req.body;
  if (!customer || !items || items.length === 0) {
    return res.status(400).json({ error: 'Customer details and item list are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let customerId;
    const existing = await client.query('SELECT id FROM customers WHERE email = $1', [customer.email]);
    if (existing.rows.length > 0) {
      customerId = existing.rows[0].id;
    } else {
      const newCust = await client.query(
        `INSERT INTO customers (company_name, contact_person, mobile, email, city)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [customer.company_name, customer.contact_person, customer.mobile, customer.email, customer.city]
      );
      customerId = newCust.rows[0].id;
    }

    const enquiryNumber = `ENQ-${Date.now().toString().slice(-6)}`;
    const enquiryRes = await client.query(
      `INSERT INTO enquiries (enquiry_number, customer_id, required_date, notes, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [enquiryNumber, customerId, required_date, notes, req.user.id]
    );
    const enquiryId = enquiryRes.rows[0].id;

    for (const item of items) {
      await client.query(
        `INSERT INTO enquiry_items (enquiry_id, product_id, quantity) VALUES ($1, $2, $3)`,
        [enquiryId, item.product_id, item.quantity]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Enquiry created successfully', enquiry: enquiryRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 4. QUOTATIONS
// ==========================================
router.get('/quotations', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        q.*, 
        c.company_name,
        e.enquiry_number,
        json_agg(
          json_build_object(
            'item_id', qi.id,
            'product_id', qi.product_id,
            'product_name', p.product_name,
            'quantity', qi.quantity,
            'unit_price', qi.unit_price,
            'discount_pct', qi.discount_pct,
            'gst_pct', qi.gst_pct,
            'line_amount', qi.line_amount
          )
        ) AS items
      FROM quotations q
      JOIN customers c ON q.customer_id = c.id
      JOIN enquiries e ON q.enquiry_id = e.id
      JOIN quotation_items qi ON q.id = qi.quotation_id
      JOIN products p ON qi.product_id = p.id
      GROUP BY q.id, c.company_name, e.enquiry_number
      ORDER BY q.id DESC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/quotations', authenticateToken, authorizeRole('SALES', 'SALES_USER', 'ADMIN'), async (req, res) => {
  const { enquiry_id, valid_until, items } = req.body;
  if (!enquiry_id || !items || items.length === 0) {
    return res.status(400).json({ error: 'Enquiry reference and items required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const enquiryRes = await client.query('SELECT customer_id FROM enquiries WHERE id = $1', [enquiry_id]);
    if (enquiryRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Enquiry not found' });
    }
    const customer_id = enquiryRes.rows[0].customer_id;

    let grandTotal = 0;
    const computedItems = [];

    for (const item of items) {
      const lineTotal = calculateItemTotal(
        Number(item.quantity),
        Number(item.unit_price),
        Number(item.discount_pct || 0),
        Number(item.gst_pct || 18)
      );
      grandTotal += lineTotal;
      computedItems.push({ ...item, lineTotal });
    }

    grandTotal = Number(grandTotal.toFixed(2));
    const quoteNumber = `QT-${Date.now().toString().slice(-6)}`;

    const quoteRes = await client.query(
      `INSERT INTO quotations (quotation_number, enquiry_id, customer_id, valid_until, grand_total, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6) RETURNING *`,
      [quoteNumber, enquiry_id, customer_id, valid_until, grandTotal, req.user.id]
    );
    const quotationId = quoteRes.rows[0].id;

    for (const cItem of computedItems) {
      await client.query(
        `INSERT INTO quotation_items (quotation_id, product_id, quantity, unit_price, discount_pct, gst_pct, line_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [quotationId, cItem.product_id, cItem.quantity, cItem.unit_price, cItem.discount_pct || 0, cItem.gst_pct || 18, cItem.lineTotal]
      );
    }

    await client.query('UPDATE enquiries SET status = $1 WHERE id = $2', ['QUOTED', enquiry_id]);
    await client.query('COMMIT');

    res.status(201).json({ quotation: quoteRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch('/quotations/:id/status', authenticateToken, authorizeRole('SALES', 'SALES_USER', 'ADMIN'), async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;

  if (!['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const result = await pool.query(
      'UPDATE quotations SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Quotation not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/quotations/:id/convert', authenticateToken, authorizeRole('SALES', 'SALES_USER', 'ADMIN'), async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const quoteRes = await client.query('SELECT * FROM quotations WHERE id = $1', [id]);
    if (quoteRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Quotation not found' });
    }
    const quotation = quoteRes.rows[0];

    if (quotation.status !== 'ACCEPTED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cannot convert quotation with status: ${quotation.status}. Must be ACCEPTED.` });
    }

    const existingOrder = await client.query('SELECT id FROM sales_orders WHERE quotation_id = $1', [id]);
    if (existingOrder.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Sales Order already exists for this Quotation.' });
    }

    const orderNumber = `SO-${Date.now().toString().slice(-6)}`;
    const orderRes = await client.query(
      `INSERT INTO sales_orders (order_number, quotation_id, customer_id, total_amount, status, created_by)
       VALUES ($1, $2, $3, $4, 'PENDING', $5) RETURNING *`,
      [orderNumber, quotation.id, quotation.customer_id, quotation.grand_total, req.user.id]
    );
    const orderId = orderRes.rows[0].id;

    const quoteItems = await client.query('SELECT * FROM quotation_items WHERE quotation_id = $1', [id]);
    for (const item of quoteItems.rows) {
      await client.query(
        `INSERT INTO sales_order_items (sales_order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)`,
        [orderId, item.product_id, item.quantity, item.unit_price]
      );
    }

    await client.query('UPDATE enquiries SET status = $1 WHERE id = $2', ['WON', quotation.enquiry_id]);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Converted to Sales Order', sales_order: orderRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 5. SALES ORDERS & STOCK RESERVATION
// ==========================================
router.get('/sales-orders', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        so.*,
        c.company_name,
        q.quotation_number,
        d.dispatch_number, d.vehicle_number, d.driver_name, d.dispatch_date,
        json_agg(
          json_build_object(
            'item_id', soi.id,
            'product_id', soi.product_id,
            'product_name', p.product_name,
            'quantity', soi.quantity,
            'unit_price', soi.unit_price
          )
        ) AS items
      FROM sales_orders so
      JOIN customers c ON so.customer_id = c.id
      JOIN quotations q ON so.quotation_id = q.id
      JOIN sales_order_items soi ON so.id = soi.sales_order_id
      JOIN products p ON soi.product_id = p.id
      LEFT JOIN dispatches d ON so.id = d.sales_order_id
      GROUP BY so.id, c.company_name, q.quotation_number, d.dispatch_number, d.vehicle_number, d.driver_name, d.dispatch_date
      ORDER BY so.id DESC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin confirms sales order -> reserves inventory using SELECT FOR UPDATE
router.post('/sales-orders/:id/confirm', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderRes = await client.query('SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE', [id]);
    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sales Order not found' });
    }
    const order = orderRes.rows[0];

    if (order.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Order status is ${order.status}. Only PENDING orders can be confirmed.` });
    }

    const itemsRes = await client.query(
      'SELECT product_id, quantity FROM sales_order_items WHERE sales_order_id = $1 ORDER BY product_id ASC',
      [id]
    );

    for (const item of itemsRes.rows) {
      const invRes = await client.query(
        'SELECT physical_qty AS physical_quantity, reserved_qty AS reserved_quantity FROM inventory WHERE product_id = $1 FOR UPDATE',
        [item.product_id]
      );

      if (invRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Inventory record missing for product ID ${item.product_id}` });
      }

      const { physical_quantity, reserved_quantity } = invRes.rows[0];
      const available_quantity = physical_quantity - reserved_quantity;

      if (item.quantity > available_quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Insufficient stock for product ID ${item.product_id}. Required: ${item.quantity}, Available: ${available_quantity}`
        });
      }

      await client.query(
        'UPDATE inventory SET reserved_qty = reserved_qty + $1 WHERE product_id = $2',
        [item.quantity, item.product_id]
      );
    }

    await client.query('UPDATE sales_orders SET status = $1 WHERE id = $2', ['CONFIRMED', id]);
    await client.query('COMMIT');
    res.json({ message: 'Order confirmed and inventory reserved successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Admin processes dispatch
router.post('/sales-orders/:id/dispatch', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const { vehicle_number, driver_name } = req.body;

  if (!vehicle_number || !driver_name) {
    return res.status(400).json({ error: 'Vehicle number and Driver name are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query('SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE', [id]);
    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sales Order not found' });
    }
    const order = orderRes.rows[0];

    if (order.status !== 'CONFIRMED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cannot dispatch order with status: ${order.status}. Must be CONFIRMED.` });
    }

    const existingDispatch = await client.query('SELECT id FROM dispatches WHERE sales_order_id = $1', [id]);
    if (existingDispatch.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This Sales Order is already dispatched' });
    }

    const itemsRes = await client.query(
      'SELECT product_id, quantity FROM sales_order_items WHERE sales_order_id = $1 ORDER BY product_id ASC',
      [id]
    );

    for (const item of itemsRes.rows) {
      const invRes = await client.query(
        'SELECT physical_qty AS physical_quantity, reserved_qty AS reserved_quantity FROM inventory WHERE product_id = $1 FOR UPDATE',
        [item.product_id]
      );
      const { physical_quantity, reserved_quantity } = invRes.rows[0];

      if (reserved_quantity < item.quantity || physical_quantity < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Corrupt state: reserved stock lower than dispatch quantity' });
      }

      await client.query(
        `UPDATE inventory 
         SET physical_qty = physical_qty - $1, 
             reserved_qty = reserved_qty - $1 
         WHERE product_id = $2`,
        [item.quantity, item.product_id]
      );
    }

    const dispatchNumber = `DSP-${Date.now().toString().slice(-6)}`;
    await client.query(
      `INSERT INTO dispatches (dispatch_number, sales_order_id, vehicle_number, driver_name, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [dispatchNumber, id, vehicle_number, driver_name, req.user.id]
    );

    await client.query('UPDATE sales_orders SET status = $1 WHERE id = $2', ['DISPATCHED', id]);
    await client.query('COMMIT');
    res.json({ message: 'Order dispatched successfully', dispatch_number: dispatchNumber });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
