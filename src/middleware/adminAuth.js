import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { findById } from '../models/users.js';

const ENV_ADMIN_ID = 'env-admin';
const ADMIN_EMAIL = () => (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

// Hash-compare so timing doesn't reveal how many characters matched
const same = (x, y) =>
  crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(x)).digest(),
    crypto.createHash('sha256').update(String(y)).digest()
  );

export const adminUser = () => ({ id: ENV_ADMIN_ID, name: 'Admin', email: ADMIN_EMAIL(), role: 'admin' });
export const isAdminEmail = (email) => ADMIN_EMAIL() !== '' && email === ADMIN_EMAIL();

// True only for the exact ADMIN_EMAIL + ADMIN_PASSWORD from .env
export function envAdminMatches(email, password) {
  const expectedPassword = process.env.ADMIN_PASSWORD || '';
  if (!ADMIN_EMAIL() || !expectedPassword) return false;
  const emailOk = same(email, ADMIN_EMAIL());
  const passwordOk = same(password, expectedPassword);
  return emailOk && passwordOk;
}

export const signEnvAdminToken = () =>
  jwt.sign({ sub: ENV_ADMIN_ID }, process.env.JWT_SECRET, { expiresIn: '12h', algorithm: 'HS256' });

export const signToken = (user) =>
  jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });

// Any logged-in user. Loads the user fresh from the database each time,
// so removing someone's admin role takes effect immediately.
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Please log in.' });

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    // Old password-era admin tokens have no "sub", so they stop working here
    if (typeof payload.sub !== 'string') return res.status(401).json({ error: 'Please log in again.' });

    // The .env admin has no database row
    if (payload.sub === ENV_ADMIN_ID) {
      if (!ADMIN_EMAIL() || !process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Please log in.' });
      req.user = adminUser();
      return next();
    }

    const user = await findById(payload.sub);
    if (!user) return res.status(401).json({ error: 'Please log in.' });

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Same name your admin.js already imports
export function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
    next();
  });
}