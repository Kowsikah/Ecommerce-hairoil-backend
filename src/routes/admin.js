import { Router } from 'express';
import { z } from 'zod';
import { pool, query } from '../db/pool.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = Router();
const uuid = z.string().uuid();

// Everything below needs a logged-in user whose role is 'admin'
router.use(requireAdmin);

/* GET /api/admin/orders */
router.get('/orders', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT o.id, o.status, o.subtotal, o.shipping_fee, o.total, o.payment_method,
             o.shipping_name, o.shipping_phone, o.shipping_address, o.city, o.state,
             o.pincode, o.email, o.notes, o.created_at,
             o.courier, o.tracking_number, o.tracking_url,
             COALESCE(
               json_agg(json_build_object('name', p.name, 'quantity', oi.quantity, 'unit_price', oi.unit_price))
               FILTER (WHERE oi.id IS NOT NULL), '[]'
             ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 200`);
    res.json(rows);
  } catch (e) { next(e); }
});

/* PATCH /api/admin/orders/:id/status */
const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

// Optional courier details, shown to the customer on the Track Order page
const trackingSchema = z.object({
  courier: z.string().trim().max(100).optional(),
  trackingNumber: z.string().trim().max(100).optional(),
  trackingUrl: z.string().trim().max(500)
    .regex(/^https?:\/\//, 'Tracking link must start with https://')
    .optional().or(z.literal('')),
});

router.patch('/orders/:id/status', async (req, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const status = z.enum(STATUSES).safeParse(req.body?.status);
  const extra = trackingSchema.safeParse(req.body || {});
  if (!id.success || !status.success) return res.status(400).json({ error: 'Invalid request.' });
  if (!extra.success) return res.status(400).json({ error: extra.error.issues[0]?.message || 'Invalid request.' });
  const t = extra.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [id.data]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found.' });
    }
    if (rows[0].status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A cancelled order cannot be changed.' });
    }

    await client.query(
      `UPDATE orders SET status = $1,
         courier = COALESCE($3, courier),
         tracking_number = COALESCE($4, tracking_number),
         tracking_url = COALESCE($5, tracking_url),
         status_updated_at = NOW()
       WHERE id = $2`,
      [status.data, id.data, t.courier || null, t.trackingNumber || null, t.trackingUrl || null]
    );

    // Cancelling puts the bottles back in stock
    if (status.data === 'cancelled') {
      await client.query(
        `UPDATE products p SET stock = p.stock + oi.qty
         FROM (SELECT product_id, SUM(quantity) AS qty FROM order_items WHERE order_id = $1 GROUP BY product_id) oi
         WHERE p.id = oi.product_id`,
        [id.data]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, status: status.data });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

/* GET /api/admin/products */
router.get('/products', async (_req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, name, price, stock, size_ml, image_url FROM products ORDER BY created_at'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

/* PATCH /api/admin/products/:id */
const imageUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^(\/|https?:\/\/)/, 'Image must start with / or https://')
  .optional()
  .or(z.literal(''));

const productSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  price: z.number().min(0).max(100000).optional(),
  stock: z.number().int().min(0).max(100000).optional(),
  size_ml: z.number().int().min(1).max(5000).optional(),
  image_url: imageUrl,
});

/* POST /api/admin/products  (add a new product) */
const newProductSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(150),
  price: z.number({ invalid_type_error: 'Enter a price' }).min(0).max(100000),
  stock: z.number({ invalid_type_error: 'Enter the stock' }).int().min(0).max(100000),
  size_ml: z.number().int().min(1).max(5000).optional(),
  image_url: imageUrl,
});

router.post('/products', async (req, res, next) => {
  try {
    const body = newProductSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: body.error.issues[0]?.message || 'Invalid request.' });
    }
    const d = body.data;
    const { rows } = await query(
      `INSERT INTO products (name, price, stock, size_ml, image_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, price, stock, size_ml, image_url`,
      [d.name, d.price, d.stock, d.size_ml ?? null, d.image_url || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/products/:id', async (req, res, next) => {
  try {
    const id = uuid.safeParse(req.params.id);
    const body = productSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      return res.status(400).json({ error: body.error?.issues?.[0]?.message || 'Invalid request.' });
    }
    const d = body.data;
    const { rows } = await query(
      `UPDATE products SET
         name      = COALESCE($2, name),
         price     = COALESCE($3, price),
         stock     = COALESCE($4, stock),
         size_ml   = COALESCE($5, size_ml),
         image_url = CASE WHEN $6::text IS NULL THEN image_url WHEN $6 = '' THEN NULL ELSE $6 END
       WHERE id = $1
       RETURNING id, name, price, stock, size_ml, image_url`,
      [id.data, d.name ?? null, d.price ?? null, d.stock ?? null, d.size_ml ?? null, d.image_url ?? null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product not found.' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* DELETE /api/admin/products/:id
   Refused if the product is in any past order, so order history is never damaged. */
router.delete('/products/:id', async (req, res, next) => {
  try {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid request.' });

    const used = await query('SELECT 1 FROM order_items WHERE product_id = $1 LIMIT 1', [id.data]);
    if (used.rows[0]) {
      return res.status(409).json({
        error: 'This product is part of past orders, so it cannot be deleted. Set its stock to 0 instead.',
      });
    }

    const { rows } = await query('DELETE FROM products WHERE id = $1 RETURNING id', [id.data]);
    if (!rows[0]) return res.status(404).json({ error: 'Product not found.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* GET /api/admin/messages */
router.get('/messages', async (_req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, name, email, message, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 200'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

export default router;