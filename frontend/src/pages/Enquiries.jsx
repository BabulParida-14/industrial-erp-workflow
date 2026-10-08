import React, { useState, useEffect } from 'react';
import api from '../api/client';

export default function Enquiries() {
  const [enquiries, setEnquiries] = useState([]);
  const [products, setProducts] = useState([]);
  const [showForm, setShowForm] = useState(false);

  // Form State
  const [companyName, setCompanyName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ product_id: '', quantity: 1 }]);
  const [error, setError] = useState('');

  const loadData = async () => {
    try {
      const [eRes, pRes] = await Promise.all([
        api.get('/enquiries'),
        api.get('/inventory')
      ]);
      setEnquiries(eRes.data);
      setProducts(pRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleAddItem = () => {
    setItems([...items, { product_id: products[0]?.product_id || '', quantity: 1 }]);
  };

  const handleItemChange = (index, field, value) => {
    const updated = [...items];
    updated[index][field] = value;
    setItems(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/enquiries', {
        customer: { company_name: companyName, contact_person: contactPerson, mobile, email, city },
        required_date: requiredDate,
        notes,
        items: items.map(i => ({ product_id: parseInt(i.product_id), quantity: parseInt(i.quantity) }))
      });
      setShowForm(false);
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit enquiry');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Customer Enquiries</h2>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Close Form' : '+ New Customer Enquiry'}
        </button>
      </div>

      {showForm && (
        <div className="card">
          <h3>Create Enquiry</h3>
          {error && <p style={{ color: 'red' }}>{error}</p>}
          <form onSubmit={handleSubmit}>
            <div className="grid-2">
              <div className="form-group">
                <label>Company Name</label>
                <input required value={companyName} onChange={e => setCompanyName(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Contact Person</label>
                <input required value={contactPerson} onChange={e => setContactPerson(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Mobile</label>
                <input required value={mobile} onChange={e => setMobile(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input required type="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div className="form-group">
                <label>City</label>
                <input required value={city} onChange={e => setCity(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Required By Date</label>
                <input required type="date" value={requiredDate} onChange={e => setRequiredDate(e.target.value)} />
              </div>
            </div>

            <h4>Requested Products</h4>
            {items.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                <select
                  style={{ flex: 2, padding: '0.5rem' }}
                  value={item.product_id}
                  onChange={e => handleItemChange(idx, 'product_id', e.target.value)}
                  required
                >
                  <option value="">-- Choose Product --</option>
                  {products.map(p => (
                    <option key={p.product_id} value={p.product_id}>{p.product_name} ({p.product_code})</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  style={{ flex: 1, padding: '0.5rem' }}
                  value={item.quantity}
                  onChange={e => handleItemChange(idx, 'quantity', e.target.value)}
                  required
                />
              </div>
            ))}
            <button type="button" className="btn-secondary" onClick={handleAddItem} style={{ marginTop: '0.5rem' }}>+ Add Item</button>

            <div style={{ marginTop: '1rem' }}>
              <button type="submit" className="btn-success">Save Enquiry</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Enquiry #</th>
              <th>Customer</th>
              <th>Contact Details</th>
              <th>Products & Qty</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {enquiries.map(e => (
              <tr key={e.id}>
                <td><b>{e.enquiry_number}</b></td>
                <td>{e.company_name} ({e.city})</td>
                <td>{e.contact_person} | {e.mobile}</td>
                <td>
                  {e.items?.map((it, i) => (
                    <div key={i}>• {it.product_name} x <b>{it.quantity}</b> {it.unit}</div>
                  ))}
                </td>
                <td><span className={`badge badge-${e.status.toLowerCase()}`}>{e.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}