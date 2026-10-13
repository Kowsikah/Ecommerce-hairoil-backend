import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

try {
  await pool.query(sql);
  console.log('✅ Tables created');
} catch (e) {
  console.error('❌ Migration failed:', e.message);
} finally {
  await pool.end();
}