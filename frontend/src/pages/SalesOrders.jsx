import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function SalesOrders() {
  const [orders, setOrders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [dispatchModal, setDispatchModal] = useState(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [driverName, setDriverName] = useState('');
  const { isAdmin } = useAuth();

  const loadData = async () => {
    try {
      const [oRes, iRes] = await Promise.all([
        api.get('/sales-orders'),
        api.get('/inventory')
      ]);
      setOrders(oRes.data);
      setInventory(iRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleConfirmOrder = async (orderId) => {
    try {
      await api.post(`/sales-orders/${orderId}/confirm`);
      alert('Order Confirmed and Inventory Reserved successfully!');
      loadData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to confirm order');
    }
  };

  const handleDispatch = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/sales-orders/${dispatchModal}/dispatch`, {
        vehicle_number: vehicleNo,
        driver_name: driverName
      });
      alert('Order Dispatched and inventory stock reduced!');
      setDispatchModal(null);
      setVehicleNo('');
      setDriverName('');
      loadData();
    } catch (err) {
      alert(err.response?.data?.error || 'Dispatch failed');
    }
  };

  return (
    <div>
      {/* Live Inventory Availability Master Section */}
      <div className="card">
        <h3>Live Inventory Stock Availability</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Product Name</th>
              <th>Category</th>
              <th>Physical Qty</th>
              <th>Reserved Qty</th>
              <th>Available Qty</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map(item => (
              <tr key={item.product_id}>
                <td><code>{item.product_code}</code></td>
                <td>{item.product_name}</td>
                <td>{item.category}</td>
                <td>{item.physical_qty}</td>
                <td><span style={{ color: item.reserved_qty > 0 ? '#b45309' : '#6b7280' }}>{item.reserved_qty}</span></td>
                <td>
                  <b style={{ color: item.available_qty <= 10 ? '#dc2626' : '#15803d' }}>
                    {item.available_qty} {item.unit}
                  </b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sales Orders Management */}
      <div className="card">
        <h3>Sales Orders & Dispatches</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Order #</th>
              <th>Customer</th>
              <th>Quote Ref</th>
              <th>Total Amount</th>
              <th>Items & Qty</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(order => (
              <tr key={order.id}>
                <td><b>{order.order_number}</b></td>
                <td>{order.company_name}</td>
                <td>{order.quotation_number}</td>
                <td>₹{parseFloat(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td>
                  {order.items?.map((it, idx) => (
                    <div key={idx}>• {it.product_name} x <b>{it.quantity}</b></div>
                  ))}
                </td>
                <td><span className={`badge badge-${order.status.toLowerCase()}`}>{order.status}</span></td>
                <td>
                  {isAdmin ? (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {order.status === 'PENDING' && (
                        <button className="btn-primary" onClick={() => handleConfirmOrder(order.id)}>
                          Confirm & Reserve
                        </button>
                      )}
                      {order.status === 'CONFIRMED' && (
                        <button className="btn-success" onClick={() => setDispatchModal(order.id)}>
                          Process Dispatch
                        </button>
                      )}
                      {order.status === 'DISPATCHED' && <span>Completed</span>}
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Admin action required</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Dispatch Modal */}
      {dispatchModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>Dispatch Order #{orders.find(o => o.id === dispatchModal)?.order_number}</h3>
            <form onSubmit={handleDispatch}>
              <div className="form-group">
                <label>Vehicle Number</label>
                <input required placeholder="e.g. MH-12-AB-1234" value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Driver Name</label>
                <input required placeholder="e.g. Ramesh Singh" value={driverName} onChange={e => setDriverName(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                <button type="submit" className="btn-success">Confirm & Deduct Stock</button>
                <button type="button" className="btn-secondary" onClick={() => setDispatchModal(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}