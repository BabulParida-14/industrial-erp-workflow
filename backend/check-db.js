const { Pool } = require('pg');
require('dotenv').config();

console.log('Testing connection with:');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Loaded (starts with ' + process.env.DATABASE_URL.slice(0, 15) + '...)' : 'MISSING / UNDEFINED');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com') 
    ? { rejectUnauthorized: false } 
    : false
});

async function testConnection() {
  try {
    // 1. Basic Ping Test
    const timeRes = await pool.query('SELECT NOW() as current_time, current_database() as db_name, current_user as db_user;');
    console.log('\n--- CONNECTION SUCCESSFUL! ---');
    console.log('Connected Database:', timeRes.rows[0].db_name);
    console.log('Connected User    :', timeRes.rows[0].db_user);
    console.log('Server Time       :', timeRes.rows[0].current_time);

    // 2. Check if the "users" table exists
    const tableRes = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
    
    const tableNames = tableRes.rows.map(r => r.table_name);
    console.log('\n--- EXISTING TABLES ---');
    console.log(tableNames.length > 0 ? tableNames : 'No tables found in this database!');

    // 3. Check Seeded Users
    if (tableNames.includes('users')) {
      const usersRes = await pool.query('SELECT id, full_name, email, role FROM users;');
      console.log('\n--- REGISTERED USERS ---');
      console.table(usersRes.rows);
    } else {
      console.log('\nWARNING: The "users" table has not been created yet. Run your init.sql / seed script.');
    }

  } catch (err) {
    console.error('\n--- CONNECTION FAILED ---');
    console.error('Error Code   :', err.code);
    console.error('Error Message:', err.message);
    if (err.detail) console.error('Detail       :', err.detail);
  } finally {
    await pool.end();
  }
}

testConnection();