const db = require('../config/db');

exports.getEnquiries = async (req, res) => {
  try {
    const query = `
      SELECT e.*, c.company_name, c.contact_person, c.mobile, c.email, c.city,
             COALESCE(
               json_agg(json_build_object(
                 'id', ei.id,
                 'product_id', p.id,
                 'product_name', p.product_name,
                 'product_code', p.product_code,
                 'quantity', ei.quantity,
                 'unit', p.unit
               )) FILTER (WHERE ei.id IS NOT NULL), '[]'
             ) as items
      FROM enquiries e
      JOIN customers c ON e.customer_id = c.id
      LEFT JOIN enquiry_items ei ON e.id = ei.enquiry_id
      LEFT JOIN products p ON ei.product_id = p.id
      GROUP BY e.id, c.id
      ORDER BY e.id DESC;
    `;
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createEnquiry = async (req, res) => {
  const client = await db.getClient();
  try {
    const { customer, required_date, notes, items } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one product item is required' });
    }

    await client.query('BEGIN');

    let customerId = customer.id;
    if (!customerId) {
      const custRes = await client.query(
        `INSERT INTO customers (company_name, contact_person, mobile, email, city)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [customer.company_name, customer.contact_person, customer.mobile, customer.email, customer.city]
      );
      customerId = custRes.rows[0].id;
    }

    const enquiryNumber = `ENQ-${Date.now().toString().slice(-6)}`;
    const enqRes = await client.query(
      `INSERT INTO enquiries (enquiry_number, customer_id, required_date, notes, status, created_by)
       VALUES ($1, $2, $3, $4, 'NEW', $5) RETURNING *`,
      [enquiryNumber, customerId, required_date, notes || '', req.user.id]
    );
    const enquiry = enqRes.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO enquiry_items (enquiry_id, product_id, quantity) VALUES ($1, $2, $3)`,
        [enquiry.id, item.product_id, item.quantity]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(enquiry);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};