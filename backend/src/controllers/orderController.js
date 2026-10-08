const db = require('../config/db');

exports.getOrders = async (req, res) => {
  try {
    const query = `
      SELECT so.*, c.company_name, q.quotation_number,
             COALESCE(
               json_agg(json_build_object(
                 'id', soi.id,
                 'product_id', p.id,
                 'product_name', p.product_name,
                 'product_code', p.product_code,
                 'quantity', soi.quantity
               )) FILTER (WHERE soi.id IS NOT NULL), '[]'
             ) as items
      FROM sales_orders so
      JOIN customers c ON so.customer_id = c.id
      JOIN quotations q ON so.quotation_id = q.id
      LEFT JOIN sales_order_items soi ON so.id = soi.sales_order_id
      LEFT JOIN products p ON soi.product_id = p.id
      GROUP BY so.id, c.id, q.id
      ORDER BY so.id DESC;
    `;
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 1. Convert Accepted Quotation to Sales Order
exports.convertQuotation = async (req, res) => {
  const { id } = req.params;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const quoRes = await client.query('SELECT * FROM quotations WHERE id = $1', [id]);
    if (quoRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Quotation not found' });
    }
    const quotation = quoRes.rows[0];

    // Rule: Only ACCEPTED quotations can create an order
    if (quotation.status !== 'ACCEPTED') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Cannot convert quotation with status '${quotation.status}'. Status must be 'ACCEPTED'.`
      });
    }

    // Rule: One quotation cannot accidentally generate multiple Sales Orders
    const existingOrder = await client.query('SELECT id FROM sales_orders WHERE quotation_id = $1', [id]);
    if (existingOrder.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'A Sales Order has already been generated for this quotation.' });
    }

    const orderNumber = `SO-${Date.now().toString().slice(-6)}`;
    const soRes = await client.query(
      `INSERT INTO sales_orders (order_number, customer_id, quotation_id, total_amount, status, created_by)
       VALUES ($1, $2, $3, $4, 'PENDING', $5) RETURNING *`,
      [orderNumber, quotation.customer_id, quotation.id, quotation.grand_total, req.user.id]
    );
    const order = soRes.rows[0];

    const itemsRes = await client.query('SELECT * FROM quotation_items WHERE quotation_id = $1', [id]);
    for (const item of itemsRes.rows) {
      await client.query(
        `INSERT INTO sales_order_items (sales_order_id, product_id, quantity) VALUES ($1, $2, $3)`,
        [order.id, item.product_id, item.quantity]
      );
    }

    // Mark enquiry WON
    await client.query(`UPDATE enquiries SET status = 'WON' WHERE id = $1`, [quotation.enquiry_id]);

    await client.query('COMMIT');
    res.status(201).json(order);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// 2. Inventory Reservation with Row-Level Locking (Pessimistic Concurrency Control)
exports.confirmOrder = async (req, res) => {
  const { id } = req.params;
  const client = await db.getClient();
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
      return res.status(400).json({ error: `Cannot confirm order in '${order.status}' status` });
    }

    const itemsRes = await client.query(
      'SELECT product_id, quantity FROM sales_order_items WHERE sales_order_id = $1 ORDER BY product_id',
      [id]
    );

    // Lock inventory rows deterministically (ORDER BY product_id) to eliminate deadlocks
    for (const item of itemsRes.rows) {
      const invRes = await client.query(
        `SELECT product_id, physical_qty, reserved_qty 
         FROM inventory 
         WHERE product_id = $1 
         FOR UPDATE`,
        [item.product_id]
      );

      if (invRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `No inventory record for product ${item.product_id}` });
      }

      const inv = invRes.rows[0];
      const available = inv.physical_qty - inv.reserved_qty;

      if (available < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Insufficient stock for Product ID ${item.product_id}. Available: ${available}, Required: ${item.quantity}`
        });
      }

      // Reserve stock: physical inventory remains untouched, reserved_qty increases
      await client.query(
        `UPDATE inventory 
         SET reserved_qty = reserved_qty + $1 
         WHERE product_id = $2`,
        [item.quantity, item.product_id]
      );
    }

    const updatedOrder = await client.query(
      `UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = $1 RETURNING *`,
      [id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Order confirmed and inventory reserved', order: updatedOrder.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// 3. Dispatch Confirmed Order
exports.dispatchOrder = async (req, res) => {
  const { id } = req.params;
  const { vehicle_number, driver_name } = req.body;

  if (!vehicle_number || !driver_name) {
    return res.status(400).json({ error: 'Vehicle number and Driver name are required' });
  }

  const client = await db.getClient();
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
      return res.status(400).json({
        error: `Only CONFIRMED orders can be dispatched. Current status: '${order.status}'.`
      });
    }

    const dispatchNumber = `DSP-${Date.now().toString().slice(-6)}`;
    const dspRes = await client.query(
      `INSERT INTO dispatches (dispatch_number, sales_order_id, vehicle_number, driver_name, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [dispatchNumber, order.id, vehicle_number, driver_name, req.user.id]
    );
    const dispatch = dspRes.rows[0];

    const itemsRes = await client.query(
      'SELECT product_id, quantity FROM sales_order_items WHERE sales_order_id = $1 ORDER BY product_id',
      [id]
    );

    for (const item of itemsRes.rows) {
      // Row lock inventory
      const invRes = await client.query(
        'SELECT physical_qty, reserved_qty FROM inventory WHERE product_id = $1 FOR UPDATE',
        [item.product_id]
      );
      const inv = invRes.rows[0];

      if (inv.reserved_qty < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Dispatch quantity (${item.quantity}) exceeds reserved quantity (${inv.reserved_qty})`
        });
      }

      // Physical decreases AND Reserved decreases
      await client.query(
        `UPDATE inventory 
         SET physical_qty = physical_qty - $1, 
             reserved_qty = reserved_qty - $1 
         WHERE product_id = $2`,
        [item.quantity, item.product_id]
      );

      await client.query(
        `INSERT INTO dispatch_items (dispatch_id, product_id, quantity) VALUES ($1, $2, $3)`,
        [dispatch.id, item.product_id, item.quantity]
      );
    }

    await client.query(`UPDATE sales_orders SET status = 'DISPATCHED' WHERE id = $1`, [id]);

    await client.query('COMMIT');
    res.json({ message: 'Dispatched successfully', dispatch });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};