const db = require('../config/db');

exports.getQuotations = async (req, res) => {
  try {
    const query = `
      SELECT q.*, c.company_name, e.enquiry_number,
             COALESCE(
               json_agg(json_build_object(
                 'id', qi.id,
                 'product_id', p.id,
                 'product_name', p.product_name,
                 'product_code', p.product_code,
                 'quantity', qi.quantity,
                 'unit_price', qi.unit_price,
                 'discount_pct', qi.discount_pct,
                 'gst_pct', qi.gst_pct,
                 'line_amount', qi.line_amount
               )) FILTER (WHERE qi.id IS NOT NULL), '[]'
             ) as items
      FROM quotations q
      JOIN customers c ON q.customer_id = c.id
      JOIN enquiries e ON q.enquiry_id = e.id
      LEFT JOIN quotation_items qi ON q.id = qi.quotation_id
      LEFT JOIN products p ON qi.product_id = p.id
      GROUP BY q.id, c.id, e.id
      ORDER BY q.id DESC;
    `;
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Backend strict calculation of item amounts and grand total
exports.createQuotation = async (req, res) => {
  const client = await db.getClient();
  try {
    const { enquiry_id, valid_until, items } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Quotation items cannot be empty' });
    }

    await client.query('BEGIN');

    const enqRes = await client.query('SELECT * FROM enquiries WHERE id = $1', [enquiry_id]);
    if (enqRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Enquiry not found' });
    }
    const customer_id = enqRes.rows[0].customer_id;

    let calculatedGrandTotal = 0;
    const computedItems = [];

    for (const item of items) {
      const pRes = await client.query('SELECT base_price FROM products WHERE id = $1', [item.product_id]);
      if (pRes.rows.length === 0) {
        throw new Error(`Product ${item.product_id} not found`);
      }
      
      const unitPrice = parseFloat(item.unit_price !== undefined ? item.unit_price : pRes.rows[0].base_price);
      const qty = parseInt(item.quantity, 10);
      const discountPct = parseFloat(item.discount_pct || 0);
      const gstPct = parseFloat(item.gst_pct !== undefined ? item.gst_pct : 18.00);

      const baseAmount = qty * unitPrice;
      const discountedAmount = baseAmount - (baseAmount * (discountPct / 100));
      const lineTotal = discountedAmount + (discountedAmount * (gstPct / 100));
      const roundedLineTotal = Math.round(lineTotal * 100) / 100;

      calculatedGrandTotal += roundedLineTotal;
      computedItems.push({
        product_id: item.product_id,
        quantity: qty,
        unit_price: unitPrice,
        discount_pct: discountPct,
        gst_pct: gstPct,
        line_amount: roundedLineTotal
      });
    }

    calculatedGrandTotal = Math.round(calculatedGrandTotal * 100) / 100;
    const quotationNumber = `QUO-${Date.now().toString().slice(-6)}`;

    const quoRes = await client.query(
      `INSERT INTO quotations (quotation_number, enquiry_id, customer_id, grand_total, valid_until, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6) RETURNING *`,
      [quotationNumber, enquiry_id, customer_id, calculatedGrandTotal, valid_until, req.user.id]
    );
    const quotation = quoRes.rows[0];

    for (const ci of computedItems) {
      await client.query(
        `INSERT INTO quotation_items (quotation_id, product_id, quantity, unit_price, discount_pct, gst_pct, line_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [quotation.id, ci.product_id, ci.quantity, ci.unit_price, ci.discount_pct, ci.gst_pct, ci.line_amount]
      );
    }

    await client.query(`UPDATE enquiries SET status = 'QUOTED' WHERE id = $1`, [enquiry_id]);
    await client.query('COMMIT');
    res.status(201).json(quotation);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.updateStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const result = await db.query(
      `UPDATE quotations SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Quotation not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};