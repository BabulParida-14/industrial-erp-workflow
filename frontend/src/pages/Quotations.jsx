import React, { useState, useEffect } from 'react';
import api from '../api/client';

export default function Quotations() {
  const [quotations, setQuotations] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [showModal, setShowModal] = useState(false);

  // Form State
  const [selectedEnquiry, setSelectedEnquiry] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [quoteItems, setQuoteItems] = useState([]);

  const loadData = async () => {
    try {
      const [qRes, eRes] = await Promise.all([
        api.get('/quotations'),
        api.get('/enquiries')
      ]);
      setQuotations(qRes.data);
      setEnquiries(eRes.data.filter(e => e.status !== 'WON'));
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSelectEnquiry = (enqId) => {
    setSelectedEnquiry(enqId);
    const enq = enquiries.find(e => e.id === parseInt(enqId));
    if (enq && enq.items) {
      setQuoteItems(enq.items.map(i => ({
        product_id: i.product_id,
        product_name: i.product_name,
        quantity: i.quantity,
        unit_price: '',
        discount_pct: 0,
        gst_pct: 18
      })));
    }
  };

  const handleItemChange = (index, field, val) => {
    const updated = [...quoteItems];
    updated[index][field] = val;
    setQuoteItems(updated);
  };

  const handleCreateQuotation = async (e) => {
    e.preventDefault();
    try {
      await api.post('/quotations', {
        enquiry_id: selectedEnquiry,
        valid_until: validUntil,
        items: quoteItems
      });
      setShowModal(false);
      loadData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create quotation');
    }
  };

  const updateStatus = async (id, status) => {
    try {
      await api.patch(`/quotations/${id}/status`, { status });
      loadData();
    } catch (err) {
      alert(err.response?.data?.error || 'Update failed');
    }
  };

  const convertToOrder = async (id) => {
    try {
      await api.post(`/quotations/${id}/convert`);
      alert('Successfully converted to Sales Order!');
      loadData();
    } catch (err) {
      alert(err.response?.data?.error || 'Conversion failed');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Quotations</h2>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ Generate Quotation</button>
      </div>

      {showModal && (
        <div className="modal">
          <div className="modal-content" style={{ width: '750px' }}>
            <h3>Create Quotation against Enquiry</h3>
            <form onSubmit={handleCreateQuotation}>
              <div className="form-group">
                <label>Select Enquiry</label>
                <select value={selectedEnquiry} onChange={e => handleSelectEnquiry(e.target.value)} required>
                  <option value="">-- Choose Enquiry --</option>
                  {enquiries.map(enq => (
                    <option key={enq.id} value={enq.id}>
                      {enq.enquiry_number} - {enq.company_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Valid Until Date</label>
                <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} required />
              </div>

              {quoteItems.length > 0 && (
                <div>
                  <h4>Pricing Details</h4>
                  {quoteItems.map((it, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                      <span style={{ width: '180px', fontSize: '0.85rem' }}>{it.product_name} (x{it.quantity})</span>
                      <input
                        type="number"
                        placeholder="Unit Price"
                        value={it.unit_price}
                        onChange={e => handleItemChange(idx, 'unit_price', e.target.value)}
                        required
                        style={{ width: '110px' }}
                      />
                      <input
                        type="number"
                        placeholder="Disc %"
                        value={it.discount_pct}
                        onChange={e => handleItemChange(idx, 'discount_pct', e.target.value)}
                        style={{ width: '80px' }}
                      />
                      <input
                        type="number"
                        placeholder="GST %"
                        value={it.gst_pct}
                        onChange={e => handleItemChange(idx, 'gst_pct', e.target.value)}
                        style={{ width: '80px' }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                <button type="submit" className="btn-success">Calculate & Save Quotation</button>
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Quote #</th>
              <th>Customer</th>
              <th>Enquiry Ref</th>
              <th>Grand Total (₹)</th>
              <th>Valid Until</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {quotations.map(q => (
              <tr key={q.id}>
                <td><b>{q.quotation_number}</b></td>
                <td>{q.company_name}</td>
                <td>{q.enquiry_number}</td>
                <td><b>₹{parseFloat(q.grand_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b></td>
                <td>{new Date(q.valid_until).toLocaleDateString()}</td>
                <td><span className={`badge badge-${q.status.toLowerCase()}`}>{q.status}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {q.status === 'DRAFT' && (
                      <button className="btn-secondary" onClick={() => updateStatus(q.id, 'SENT')}>Mark Sent</button>
                    )}
                    {q.status === 'SENT' && (
                      <>
                        <button className="btn-success" onClick={() => updateStatus(q.id, 'ACCEPTED')}>Accept</button>
                        <button className="btn-danger" onClick={() => updateStatus(q.id, 'REJECTED')}>Reject</button>
                      </>
                    )}
                    {q.status === 'ACCEPTED' && (
                      <button className="btn-primary" onClick={() => convertToOrder(q.id)}>Convert to Order</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}