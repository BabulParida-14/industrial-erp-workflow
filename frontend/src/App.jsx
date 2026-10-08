// frontend/src/App.jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('erp_token') || '');
  const [currentUser, setCurrentUser] = useState(JSON.parse(localStorage.getItem('erp_user') || 'null'));
  const [activeTab, setActiveTab] = useState('enquiries');

  // Application Data States
  const [products, setProducts] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Login Form State
  const [loginForm, setLoginForm] = useState({ email: 'admin@erp.com', password: 'Password@123' });

  // Enquiry Form State
  const [enqForm, setEnqForm] = useState({
    company_name: '', contact_person: '', mobile: '', email: '', city: '',
    required_date: '', notes: '', product_id: '', quantity: 1
  });

  // Quotation Form State
  const [quoteForm, setQuoteForm] = useState({
    enquiry_id: '', valid_until: '', product_id: '', quantity: 1, unit_price: 1000, discount_pct: 0, gst_pct: 18
  });

  // Dispatch Form State
  const [dispatchData, setDispatchData] = useState({ order_id: '', vehicle_number: '', driver_name: '' });

  const getAuthHeader = () => ({ headers: { Authorization: `Bearer ${token}` } });

  const notify = (msg, isErr = false) => {
    if (isErr) { setErrorMsg(msg); setSuccessMsg(''); }
    else { setSuccessMsg(msg); setErrorMsg(''); }
    setTimeout(() => { setErrorMsg(''); setSuccessMsg(''); }, 4500);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_BASE}/auth/login`, loginForm);
      setToken(res.data.token);
      setCurrentUser(res.data.user);
      localStorage.setItem('erp_token', res.data.token);
      localStorage.setItem('erp_user', JSON.stringify(res.data.user));
      notify(`Welcome back, ${res.data.user.full_name}`);
    } catch (err) {
      notify(err.response?.data?.error || 'Login failed', true);
    }
  };

  const handleLogout = () => {
    setToken('');
    setCurrentUser(null);
    localStorage.clear();
  };

  const loadAllData = async () => {
    if (!token) return;
    try {
      const auth = getAuthHeader();
      const [prodRes, enqRes, quoteRes, orderRes] = await Promise.all([
        axios.get(`${API_BASE}/products`, auth),
        axios.get(`${API_BASE}/enquiries`, auth),
        axios.get(`${API_BASE}/quotations`, auth),
        axios.get(`${API_BASE}/sales-orders`, auth)
      ]);
      setProducts(prodRes.data);
      setEnquiries(enqRes.data);
      setQuotations(quoteRes.data);
      setSalesOrders(orderRes.data);
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) handleLogout();
    }
  };

  useEffect(() => { loadAllData(); }, [token]);

  // Enquiry Submission
  const handleCreateEnquiry = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/enquiries`, {
        customer: {
          company_name: enqForm.company_name,
          contact_person: enqForm.contact_person,
          mobile: enqForm.mobile,
          email: enqForm.email,
          city: enqForm.city
        },
        required_date: enqForm.required_date,
        notes: enqForm.notes,
        items: [{ product_id: parseInt(enqForm.product_id), quantity: parseInt(enqForm.quantity) }]
      }, getAuthHeader());
      notify('Enquiry created successfully!');
      setEnqForm({ company_name: '', contact_person: '', mobile: '', email: '', city: '', required_date: '', notes: '', product_id: '', quantity: 1 });
      loadAllData();
    } catch (err) {
      notify(err.response?.data?.error || 'Error creating enquiry', true);
    }
  };

  // Quotation Submission
  const handleCreateQuotation = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/quotations`, {
        enquiry_id: parseInt(quoteForm.enquiry_id),
        valid_until: quoteForm.valid_until,
        items: [{
          product_id: parseInt(quoteForm.product_id),
          quantity: parseInt(quoteForm.quantity),
          unit_price: parseFloat(quoteForm.unit_price),
          discount_pct: parseFloat(quoteForm.discount_pct),
          gst_pct: parseFloat(quoteForm.gst_pct)
        }]
      }, getAuthHeader());
      notify('Quotation created with backend-verified total calculation');
      loadAllData();
    } catch (err) {
      notify(err.response?.data?.error || 'Quotation creation failed', true);
    }
  };

  const handleUpdateQuoteStatus = async (quoteId, status) => {
    try {
      await axios.patch(`${API_BASE}/quotations/${quoteId}/status`, { status }, getAuthHeader());
      notify(`Quotation updated to ${status}`);
      loadAllData();
    } catch (err) {
      notify(err.response?.data?.error || 'Failed to update quotation status', true);
    }
  };

  const handleConvertQuote = async (quoteId) => {
    try {
      await axios.post(`${API_BASE}/quotations/${quoteId}/convert`, {}, getAuthHeader());
      notify('Quotation converted to Sales Order!');
      loadAllData();
      setActiveTab('sales-orders');
    } catch (err) {
      notify(err.response?.data?.error || 'Conversion error', true);
    }
  };

  // Sales Order Confirmation (Inventory Reservation)
  const handleConfirmOrder = async (orderId) => {
    try {
      await axios.post(`${API_BASE}/sales-orders/${orderId}/confirm`, {}, getAuthHeader());
      notify('Order Confirmed: Stock reserved successfully!');
      loadAllData();
    } catch (err) {
      notify(err.response?.data?.error || 'Failed to reserve stock', true);
    }
  };

  // Order Dispatch
  const handleDispatchOrder = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/sales-orders/${dispatchData.order_id}/dispatch`, {
        vehicle_number: dispatchData.vehicle_number,
        driver_name: dispatchData.driver_name
      }, getAuthHeader());
      notify('Order dispatched successfully. Physical stock deducted.');
      setDispatchData({ order_id: '', vehicle_number: '', driver_name: '' });
      loadAllData();
    } catch (err) {
      notify(err.response?.data?.error || 'Dispatch failed', true);
    }
  };

  // Screen 1: Login
  if (!token) {
    return (
      <div className="auth-shell">
        <section className="auth-brand">
          <div className="auth-logo">FORGE / OPERATIONS</div>
          <div><h1>Run your operation with clarity.</h1><p>One workspace for customer enquiries, quotations, sales orders and inventory movement.</p></div>
          <small>Industrial ERP · Secure workspace</small>
        </section>
        <main className="auth-panel"><div className="card">
          <p className="muted" style={{ marginBottom: 8 }}>Welcome back</p>
          <h2>Sign in to your workspace</h2>
          <p className="muted" style={{ marginBottom: 24 }}>Use your company account to continue.</p>
          {errorMsg && <div className="notice notice-error">{errorMsg}</div>}
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Email Address</label>
              <input type="email" value={loginForm.email} onChange={e => setLoginForm({...loginForm, email: e.target.value})} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})} required />
            </div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }}>Sign in</button>
          </form>
          <div className="muted" style={{ marginTop: 22, fontSize: 12 }}><strong>Demo access</strong><br/>Admin or Sales · admin@erp.com / Password@123</div>
        </div></main>
      </div>
    );
  }

  return (
    <div>
      <nav className="nav">
        <h2>Industrial ERP System</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span><strong>{currentUser?.full_name || currentUser?.name}</strong> ({currentUser?.role})</span>
          <button onClick={handleLogout}>Logout</button>
        </div>
      </nav>

      <div className="container">
        {errorMsg && <div className="card" style={{ background: '#f8d7da', color: '#721c24' }}>{errorMsg}</div>}
        {successMsg && <div className="card" style={{ background: '#d4edda', color: '#155724' }}>{successMsg}</div>}

        <div className="tabs">
          <button className={`tab-btn ${activeTab === 'enquiries' ? 'active' : ''}`} onClick={() => setActiveTab('enquiries')}>
            1. Enquiries
          </button>
          <button className={`tab-btn ${activeTab === 'quotations' ? 'active' : ''}`} onClick={() => setActiveTab('quotations')}>
            2. Quotations
          </button>
          <button className={`tab-btn ${activeTab === 'sales-orders' ? 'active' : ''}`} onClick={() => setActiveTab('sales-orders')}>
            3. Sales Orders & Stock Reservation
          </button>
        </div>

        {/* Screen 2: Enquiries */}
        {activeTab === 'enquiries' && (
          <div>
            <div className="card">
              <h3>Create Customer Enquiry</h3>
              <form onSubmit={handleCreateEnquiry} style={{ marginTop: '15px' }}>
                <div className="grid-3">
                  <div className="form-group">
                    <label>Company Name</label>
                    <input type="text" required value={enqForm.company_name} onChange={e => setEnqForm({...enqForm, company_name: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Contact Person</label>
                    <input type="text" required value={enqForm.contact_person} onChange={e => setEnqForm({...enqForm, contact_person: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>City</label>
                    <input type="text" required value={enqForm.city} onChange={e => setEnqForm({...enqForm, city: e.target.value})} />
                  </div>
                </div>
                <div className="grid-3">
                  <div className="form-group">
                    <label>Mobile Number</label>
                    <input type="text" required value={enqForm.mobile} onChange={e => setEnqForm({...enqForm, mobile: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Email Address</label>
                    <input type="email" required value={enqForm.email} onChange={e => setEnqForm({...enqForm, email: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Required Date</label>
                    <input type="date" required value={enqForm.required_date} onChange={e => setEnqForm({...enqForm, required_date: e.target.value})} />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label>Select Product</label>
                    <select required value={enqForm.product_id} onChange={e => setEnqForm({...enqForm, product_id: e.target.value})}>
                      <option value="">-- Choose Product --</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.product_code} - {p.product_name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Quantity</label>
                    <input type="number" min="1" required value={enqForm.quantity} onChange={e => setEnqForm({...enqForm, quantity: e.target.value})} />
                  </div>
                </div>
                <div className="form-group">
                  <label>Notes</label>
                  <textarea rows="2" value={enqForm.notes} onChange={e => setEnqForm({...enqForm, notes: e.target.value})} />
                </div>
                <button className="btn btn-primary">Submit Enquiry</button>
              </form>
            </div>

            <div className="card">
              <h3>Existing Enquiries</h3>
              <table>
                <thead>
                  <tr>
                    <th>Enquiry #</th>
                    <th>Customer</th>
                    <th>City</th>
                    <th>Product & Qty</th>
                    <th>Required Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {enquiries.map(enq => (
                    <tr key={enq.id}>
                      <td><strong>{enq.enquiry_number}</strong></td>
                      <td>{enq.company_name} ({enq.contact_person})</td>
                      <td>{enq.city}</td>
                      <td>{enq.items?.map(i => `${i.product_name} (x${i.quantity})`).join(', ')}</td>
                      <td>{new Date(enq.required_date).toLocaleDateString()}</td>
                      <td><span className="badge badge-pending">{enq.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Screen 3: Quotations */}
        {activeTab === 'quotations' && (
          <div>
            <div className="card">
              <h3>Create Quotation against Enquiry</h3>
              <form onSubmit={handleCreateQuotation} style={{ marginTop: '15px' }}>
                <div className="grid-3">
                  <div className="form-group">
                    <label>Enquiry Reference</label>
                    <select required value={quoteForm.enquiry_id} onChange={e => setQuoteForm({...quoteForm, enquiry_id: e.target.value})}>
                      <option value="">-- Select Enquiry --</option>
                      {enquiries.map(e => <option key={e.id} value={e.id}>{e.enquiry_number} - {e.company_name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Valid Until</label>
                    <input type="date" required value={quoteForm.valid_until} onChange={e => setQuoteForm({...quoteForm, valid_until: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Product</label>
                    <select required value={quoteForm.product_id} onChange={e => setQuoteForm({...quoteForm, product_id: e.target.value})}>
                      <option value="">-- Select Product --</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.product_name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid-3">
                  <div className="form-group">
                    <label>Quantity</label>
                    <input type="number" min="1" value={quoteForm.quantity} onChange={e => setQuoteForm({...quoteForm, quantity: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>Unit Price (₹)</label>
                    <input type="number" step="0.01" value={quoteForm.unit_price} onChange={e => setQuoteForm({...quoteForm, unit_price: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>Discount %</label>
                    <input type="number" min="0" max="100" value={quoteForm.discount_pct} onChange={e => setQuoteForm({...quoteForm, discount_pct: e.target.value})} />
                  </div>
                </div>
                <button className="btn btn-primary">Generate Quotation</button>
              </form>
            </div>

            <div className="card">
              <h3>Quotation Master</h3>
              <table>
                <thead>
                  <tr>
                    <th>Quote #</th>
                    <th>Enquiry #</th>
                    <th>Customer</th>
                    <th>Grand Total</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {quotations.map(q => (
                    <tr key={q.id}>
                      <td><strong>{q.quotation_number}</strong></td>
                      <td>{q.enquiry_number}</td>
                      <td>{q.company_name}</td>
                      <td>₹{parseFloat(q.grand_total).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td><span className={`badge badge-${q.status.toLowerCase()}`}>{q.status}</span></td>
                      <td style={{ display: 'flex', gap: '8px' }}>
                        {q.status === 'DRAFT' && (
                          <button className="btn btn-primary" onClick={() => handleUpdateQuoteStatus(q.id, 'SENT')}>Mark Sent</button>
                        )}
                        {q.status === 'SENT' && (
                          <>
                            <button className="btn btn-success" onClick={() => handleUpdateQuoteStatus(q.id, 'ACCEPTED')}>Accept</button>
                            <button className="btn btn-danger" onClick={() => handleUpdateQuoteStatus(q.id, 'REJECTED')}>Reject</button>
                          </>
                        )}
                        {q.status === 'ACCEPTED' && (
                          <button className="btn btn-primary" onClick={() => handleConvertQuote(q.id)}>Convert to SO</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Screen 4: Sales Orders & Inventory Reservation */}
        {activeTab === 'sales-orders' && (
          <div>
            <div className="card" style={{ background: '#fcfdff' }}>
              <h3>Live Inventory Availability</h3>
              <table>
                <thead>
                  <tr>
                    <th>Product Code</th>
                    <th>Product Name</th>
                    <th>Physical Stock</th>
                    <th>Reserved</th>
                    <th>Available Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id}>
                      <td><strong>{p.product_code}</strong></td>
                      <td>{p.product_name}</td>
                      <td>{p.physical_quantity} {p.unit}</td>
                      <td>{p.reserved_quantity} {p.unit}</td>
                      <td style={{ fontWeight: 600, color: p.available_quantity < 10 ? 'red' : 'green' }}>
                        {p.available_quantity} {p.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h3>Sales Orders Execution</h3>
              <table>
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Quote Ref</th>
                    <th>Customer</th>
                    <th>Items & Qty</th>
                    <th>Total Amount</th>
                    <th>Status</th>
                    <th>Operations</th>
                  </tr>
                </thead>
                <tbody>
                  {salesOrders.map(so => (
                    <tr key={so.id}>
                      <td><strong>{so.order_number}</strong></td>
                      <td>{so.quotation_number}</td>
                      <td>{so.company_name}</td>
                      <td>{so.items?.map(i => `${i.product_name} (x${i.quantity})`).join(', ')}</td>
                      <td>₹{parseFloat(so.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td><span className={`badge badge-${so.status.toLowerCase()}`}>{so.status}</span></td>
                      <td>
                        {so.status === 'PENDING' && currentUser?.role === 'ADMIN' && (
                          <button className="btn btn-primary" onClick={() => handleConfirmOrder(so.id)}>
                            Confirm & Reserve Stock
                          </button>
                        )}
                        {so.status === 'PENDING' && currentUser?.role !== 'ADMIN' && (
                          <span style={{ fontSize: '12px', color: '#777' }}>Awaiting Admin Confirmation</span>
                        )}
                        {so.status === 'CONFIRMED' && currentUser?.role === 'ADMIN' && (
                          <button className="btn btn-success" onClick={() => setDispatchData({ ...dispatchData, order_id: so.id })}>
                            Process Dispatch
                          </button>
                        )}
                        {so.status === 'DISPATCHED' && (
                          <span style={{ fontSize: '13px' }}>Dispatched ({so.dispatch_number})</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {dispatchData.order_id && (
              <div className="card" style={{ border: '2px solid #28a745' }}>
                <h3>Complete Dispatch for Order #{salesOrders.find(o => o.id === dispatchData.order_id)?.order_number}</h3>
                <form onSubmit={handleDispatchOrder} style={{ marginTop: '15px' }}>
                  <div className="grid-2">
                    <div className="form-group">
                      <label>Vehicle Number</label>
                      <input 
                        type="text" 
                        required 
                        placeholder="e.g. MH-12-AB-1234" 
                        value={dispatchData.vehicle_number} 
                        onChange={e => setDispatchData({...dispatchData, vehicle_number: e.target.value})} 
                      />
                    </div>
                    <div className="form-group">
                      <label>Driver Name</label>
                      <input 
                        type="text" 
                        required 
                        placeholder="e.g. Ramesh Kumar" 
                        value={dispatchData.driver_name} 
                        onChange={e => setDispatchData({...dispatchData, driver_name: e.target.value})} 
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn btn-success">Confirm & Deduct Stock</button>
                    <button type="button" className="btn btn-danger" onClick={() => setDispatchData({ order_id: '', vehicle_number: '', driver_name: '' })}>
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
