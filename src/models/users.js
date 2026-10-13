import { query } from '../db/pool.js';

const COLUMNS = 'id, name, email, password_hash, role, created_at';

export async function findByEmail(email) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM users WHERE email = $1`, [email]);
  return rows[0] || null;
}

export async function findById(id) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function createUser({ name, email, passwordHash }) {
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
    [name, email, passwordHash]
  );
  return rows[0];
}

export async function setRole(email, role) {
  const result = await query('UPDATE users SET role = $2 WHERE email = $1', [email, role]);
  return result.rowCount > 0;
}
