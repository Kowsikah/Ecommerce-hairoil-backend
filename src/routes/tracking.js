import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';

const digits = (s) => String(s || '').replace(/\D/g, '');

/* ───────── PUBLIC: customer tracks an order ─────────
   POST /api/orders/track   { orderId, contact }   contact = email OR phone
   Requires BOTH the order ID and the email/phone used at checkout,
   so nobody can look up other people's orders by guessing IDs. */
export const publicTracking = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

publicTracking.post('/track', limiter, async (req, res) => {
  const orderId = String(req.body.orderId || '').trim().replace(/^#/, '').toLowerCase();
  const contact = String(req.body.contact || '').trim().toLowerCase();
  if (!orderId || !contact) {
    return res.status(400).json({ error: 'Please enter your Order ID and email or phone number.' });
  }

  // Accept the full UUID or the short ID shown in emails (first 8+ characters, e.g. #996D8554)
  if (!/^[0-9a-f-]{8,36}$/.test(orderId)) {
    return res.status(404).json({ error: 'No order found with those details.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, status, courier, tracking_number, tracking_url, status_updated_at,
              created_at, total, shipping_name, email, shipping_phone
         FROM orders WHERE id::text LIKE $1 LIMIT 5`,
      [`${orderId}%`]
    );


    // Must also match the email or phone used at checkout
    const o = rows.find((r) =>
      String(r.email || '').toLowerCase() === contact ||
      (digits(contact).length >= 10 &&
        digits(r.shipping_phone).slice(-10) === digits(contact).slice(-10))
    );

    // Same message for "no such order" and "wrong email/phone" → no information leak
    if (!o) {
      return res.status(404).json({ error: 'No order found with those details.' });
    }

    res.json({
      id: o.id,
      status: o.status,
      courier: o.courier,
      tracking_number: o.tracking_number,
      tracking_url: o.tracking_url,
      updated_at: o.status_updated_at,
      placed_at: o.created_at,
      total: o.total,
      name: o.shipping_name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not look up the order. Please try again.' });
  }
});
