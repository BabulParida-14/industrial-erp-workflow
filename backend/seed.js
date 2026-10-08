// backend/seed.js
const fs = require('fs');
const path = require('path');
const pool = require('./src/db'); // adjust to './db' if db.js is in backend/ root

async function runSeed() {
  try {
    console.log('Connecting to database...');
    // Path to init.sql
    const sqlPath = fs.existsSync(path.join(__dirname, 'db', 'init.sql'))
      ? path.join(__dirname, 'db', 'init.sql')
      : path.join(__dirname, 'src', 'db', 'init.sql');

    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('Executing init.sql...');
    await pool.query(sql);
    console.log('Database tables created and seeded successfully!');
  } catch (err) {
    console.error('Seed Error:', err);
  } finally {
    await pool.end();
  }
}

runSeed();