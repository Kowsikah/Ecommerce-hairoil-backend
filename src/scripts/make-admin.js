// Usage: node scripts/make-admin.js you@example.com          (make admin)
//        node scripts/make-admin.js you@example.com customer (remove admin)
import 'dotenv/config';
import { pool } from '../db/pool.js';
import { setRole } from '../models/users.js';

const [email, role = 'admin'] = process.argv.slice(2);
if (!email || !['admin', 'customer'].includes(role)) {
  console.error('Usage: node scripts/make-admin.js <email> [admin|customer]');
  process.exit(1);
}

const done = await setRole(email.trim().toLowerCase(), role);
console.log(done ? `✅ ${email} is now: ${role}` : `❌ No user found with email ${email}. Sign up on the site first.`);
await pool.end();
