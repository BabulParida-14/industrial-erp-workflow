# Industrial ERP System (PERN Stack)

A full-stack enterprise resource planning (ERP) system tailored for industrial manufacturing and supply-chain operations. It enforces the sequential business lifecycle: **Customer Enquiry → Quotation → Sales Order → Concurrency-Safe Stock Reservation → Dispatch**.

---

## Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL (ACID transactions, relational constraints, row-level locking)
- **Frontend:** React.js, Vite, Tailwind CSS / Modern CSS, Axios
- **Authentication & Security:** JSON Web Tokens (JWT), bcrypt password hashing, Role-Based Access Control (RBAC)
- **Testing:** Jest, Supertest

---

## Key Features & Business Logic

1. **Role-Based Access Control (RBAC):**
   - **Sales Users:** Create customer enquiries, draft quotations, transition quotation statuses, convert accepted quotations to sales orders, and view inventory.
   - **Admin Users:** Full access, including order confirmation, stock reservation, and physical dispatch execution.
2. **Deterministic State Transitions:**
   - Enquiries: `NEW`
   - Quotations: `DRAFT` → `SENT` → `ACCEPTED` / `REJECTED`
   - Sales Orders: `PENDING` → `CONFIRMED` → `DISPATCHED` (or `CANCELLED`)
3. **Backend-Calculated Financials:**
   - Line-item calculations (`Unit Price × Quantity`), optional item-level discounts, and mandatory 18% GST are calculated and verified exclusively on the server.
4. **Concurrency-Safe Stock Allocation:**
   - Available stock is computed as: `Available = Physical - Reserved`.
   - Inventory reservation locks rows using PostgreSQL `SELECT ... FOR UPDATE` inside transactions to prevent race conditions and overselling under concurrent load.
   - Physical stock remains untouched during reservation; physical deduction and reserve release occur atomically during dispatch.
5. **Traceability:**
   - Quotation to Sales Order conversion enforces a 1:1 database constraint to eliminate duplicate conversions. Every order maintains full relational links back to customer enquiries and quotation line items.

---

## Database Architecture