import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { pool, query } from '../db/pool.js';
import { sendOrderEmails } from '../utils/mailer.js';

const router = Router();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ── Shipping settings (from backend/.env, optional) ── */
const shippingConfig = () => ({
  shippingFee: Number(process.env.SHIPPING_FEE) || 0,
  freeShippingAbove: Number(process.env.FREE_SHIPPING_ABOVE) || 0,
});
const shippingFor = (subtotal) => {
  const { shippingFee, freeShippingAbove } = shippingConfig();
  return freeShippingAbove > 0 && subtotal >= freeShippingAbove ? 0 : shippingFee;
};

/* ── Validation ── */
const phone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+?91|0)(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Please enter a valid 10-digit mobile number.'));

const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: z.number().int().min(1).max(10),
      })
    )
    .min(1)
    .max(20),
  customer: z.object({
    name: z.string().trim().min(2).max(100),
    phone,
    email: z.string().trim().toLowerCase().email('Please enter a valid email address.').max(200),
    address: z.string().trim().min(5).max(300),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Please enter a valid 6-digit pincode.'),
    notes: z.string().trim().max(500).optional().or(z.literal('')),
  }),
});

// Max 20 orders per IP per hour (raise or lower as you like)
const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many orders from this connection. Please try again later.' },
});

/* GET /api/orders/config: shipping settings for the checkout page */
router.get('/config', (_req, res) => res.json(shippingConfig()));

/* POST /api/orders: place an order (guest checkout) */
router.post('/', orderLimiter, async (req, res, next) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message;
    return res.status(400).json({
      error: msg && !msg.startsWith('Invalid') ? msg : 'Please check your details and try again.',
    });
  }
  const { items, customer: c } = parsed.data;

  // Merge duplicate products
  const wanted = new Map();
  for (const { productId, qty } of items) {
    wanted.set(productId, Math.min(10, (wanted.get(productId) || 0) + qty));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the product rows so two customers can't buy the last bottle together
    const { rows: products } = await client.query(
      `SELECT id, name, price, stock FROM products
       WHERE id = ANY($1::uuid[]) AND is_active = true FOR UPDATE`,
      [[...wanted.keys()]]
    );
    if (products.length !== wanted.size) {
      throw new HttpError(400, 'A product in your cart is no longer available. Please refresh your cart.');
    }

    // Prices always come from the database, never from the browser
    let subtotal = 0;
    const lines = products.map((p) => {
      const qty = wanted.get(p.id);
      if (p.stock < qty) {
        throw new HttpError(
          409,
          p.stock === 0
            ? `Sorry, ${p.name} is out of stock.`
            : `Sorry, only ${p.stock} of ${p.name} left in stock.`
        );
      }
      subtotal += Number(p.price) * qty;
      return { productId: p.id, name: p.name, qty, unitPrice: Number(p.price) };
    });

    const shippingFee = shippingFor(subtotal);
    const total = subtotal + shippingFee;

    const { rows } = await client.query(
      `INSERT INTO orders
         (status, subtotal, shipping_fee, total, payment_method,
          shipping_name, shipping_phone, shipping_address, city, state, pincode, email, notes)
       VALUES ('pending', $1, $2, $3, 'cod', $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        subtotal, shippingFee, total,
        c.name, c.phone, c.address, c.city, c.state, c.pincode,
        c.email, c.notes || null,
      ]
    );
    const orderId = rows[0].id;

    for (const l of lines) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
        [orderId, l.productId, l.qty, l.unitPrice]
      );
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [l.qty, l.productId]);
    }

    await client.query('COMMIT');
    console.log(`✅ Order ${orderId} saved. Total: ₹${total}`);

    // Fire and forget: a failed email never fails a saved order
    sendOrderEmails({ orderId, customer: c, lines, subtotal, shippingFee, total })
      .catch((err) => console.error('Order email failed:', err.message));

    return res.status(201).json({ id: orderId, subtotal, shippingFee, total });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    console.error('❌ Order failed:', e);
    next(e);
  } finally {
    client.release();
  }
});

/* GET /api/orders/:id: order confirmation page (the long random id acts as the access key) */
router.get('/:id', async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const { rows } = await query(
      `SELECT id, status, subtotal, shipping_fee, total, payment_method,
              shipping_name, city, created_at
       FROM orders WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });

    const { rows: items } = await query(
      `SELECT p.name, oi.quantity, oi.unit_price
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [req.params.id]
    );
    res.json({ ...rows[0], items });
  } catch (e) {
    next(e);
  }
});

export default router;