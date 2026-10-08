-- TODO: Define the database schema.
-- Drop existing tables
DROP TABLE IF EXISTS dispatch_items CASCADE;
DROP TABLE IF EXISTS dispatches CASCADE;
DROP TABLE IF EXISTS sales_order_items CASCADE;
DROP TABLE IF EXISTS sales_orders CASCADE;
DROP TABLE IF EXISTS quotation_items CASCADE;
DROP TABLE IF EXISTS quotations CASCADE;
DROP TABLE IF EXISTS enquiry_items CASCADE;
DROP TABLE IF EXISTS enquiries CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. Users & Authentication
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(120) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'SALES_USER')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Customers
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    company_name VARCHAR(150) NOT NULL,
    contact_person VARCHAR(100) NOT NULL,
    mobile VARCHAR(20) NOT NULL,
    email VARCHAR(120) NOT NULL,
    city VARCHAR(80) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Products Master (Min. 6 items seeded)
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    product_code VARCHAR(50) UNIQUE NOT NULL,
    product_name VARCHAR(150) NOT NULL,
    category VARCHAR(80) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    base_price NUMERIC(12, 2) NOT NULL CHECK (base_price >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Inventory
CREATE TABLE inventory (
    id SERIAL PRIMARY KEY,
    product_id INT UNIQUE REFERENCES products(id) ON DELETE RESTRICT,
    physical_qty INT NOT NULL DEFAULT 0 CHECK (physical_qty >= 0),
    reserved_qty INT NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
    CONSTRAINT chk_reservation_limit CHECK (reserved_qty <= physical_qty)
);

-- 5. Enquiries
CREATE TABLE enquiries (
    id SERIAL PRIMARY KEY,
    enquiry_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INT REFERENCES customers(id) ON DELETE RESTRICT,
    enquiry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    required_date DATE NOT NULL,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'QUOTED', 'WON', 'LOST')),
    created_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE enquiry_items (
    id SERIAL PRIMARY KEY,
    enquiry_id INT REFERENCES enquiries(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id) ON DELETE RESTRICT,
    quantity INT NOT NULL CHECK (quantity > 0)
);

-- 6. Quotations
CREATE TABLE quotations (
    id SERIAL PRIMARY KEY,
    quotation_number VARCHAR(50) UNIQUE NOT NULL,
    enquiry_id INT REFERENCES enquiries(id) ON DELETE RESTRICT,
    customer_id INT REFERENCES customers(id) ON DELETE RESTRICT,
    grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (grand_total >= 0),
    valid_until DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED')),
    created_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quotation_items (
    id SERIAL PRIMARY KEY,
    quotation_id INT REFERENCES quotations(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id) ON DELETE RESTRICT,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (discount_pct >= 0 AND discount_pct <= 100),
    gst_pct NUMERIC(5, 2) NOT NULL DEFAULT 18.00 CHECK (gst_pct >= 0),
    line_amount NUMERIC(12, 2) NOT NULL CHECK (line_amount >= 0)
);

-- 7. Sales Orders
-- quotation_id is UNIQUE to guarantee one quotation cannot generate duplicate orders
CREATE TABLE sales_orders (
    id SERIAL PRIMARY KEY,
    order_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INT REFERENCES customers(id) ON DELETE RESTRICT,
    quotation_id INT UNIQUE REFERENCES quotations(id) ON DELETE RESTRICT,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'DISPATCHED', 'CANCELLED')),
    created_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sales_order_items (
    id SERIAL PRIMARY KEY,
    sales_order_id INT REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id) ON DELETE RESTRICT,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0)
);

-- 8. Dispatches
CREATE TABLE dispatches (
    id SERIAL PRIMARY KEY,
    dispatch_number VARCHAR(50) UNIQUE NOT NULL,
    sales_order_id INT REFERENCES sales_orders(id) ON DELETE RESTRICT,
    dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
    vehicle_number VARCHAR(50) NOT NULL,
    driver_name VARCHAR(100) NOT NULL,
    created_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dispatch_items (
    id SERIAL PRIMARY KEY,
    dispatch_id INT REFERENCES dispatches(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id) ON DELETE RESTRICT,
    quantity INT NOT NULL CHECK (quantity > 0)
);

-- -------------------------------------------------------------
-- SEED DATA
-- -------------------------------------------------------------

-- Passwords hashed with bcrypt (rounds=10) for "Password@123"
-- Hash: $2b$10$hfrE.wost74ZBqejVyTg..jb8sqtVSgagt4aBFqFC3epWT/UkX2X6
INSERT INTO users (name, email, password_hash, role) VALUES
('System Admin', 'admin@erp.com', '$2b$10$hfrE.wost74ZBqejVyTg..jb8sqtVSgagt4aBFqFC3epWT/UkX2X6', 'ADMIN'),
('Sales Representative', 'sales@erp.com', '$2b$10$hfrE.wost74ZBqejVyTg..jb8sqtVSgagt4aBFqFC3epWT/UkX2X6', 'SALES_USER');

INSERT INTO customers (company_name, contact_person, mobile, email, city) VALUES
('ABC Engineering Pvt. Ltd.', 'Rajesh Verma', '+91 9876543210', 'rajesh@abcengineering.com', 'Pune'),
('Apex Industrial Solutions', 'Suresh Kumar', '+91 9812345678', 'suresh@apexind.com', 'Ahmedabad');

-- 6 Industrial Products & Inventory Records
INSERT INTO products (id, product_code, product_name, category, unit, base_price) VALUES
(1, 'IND-PMP-001', 'Centrifugal Water Pump 5HP', 'Pumps & Motors', 'PCS', 18500.00),
(2, 'IND-VLV-002', 'High-Pressure Ball Valve 2"', 'Valves & Fittings', 'PCS', 2400.00),
(3, 'IND-BRG-003', 'Heavy Duty Roller Bearing 6205', 'Transmission', 'PCS', 950.00),
(4, 'IND-MTR-004', 'Three Phase Induction Motor 10HP', 'Pumps & Motors', 'PCS', 32000.00),
(5, 'IND-FLT-005', 'Industrial Air Filter Element', 'Filtration', 'PCS', 1250.00),
(6, 'IND-PNE-006', 'Pneumatic Actuator Double Acting', 'Pneumatics', 'PCS', 8700.00);

-- Reset sequence for products
SELECT setval('products_id_seq', (SELECT MAX(id) FROM products));

-- Seed Inventory: Physical=100, Reserved=0, Available=100
INSERT INTO inventory (product_id, physical_qty, reserved_qty) VALUES
(1, 100, 0),
(2, 100, 30), -- 70 Available for race test
(3, 200, 0),
(4, 50, 0),
(5, 300, 0),
(6, 80, 0);
