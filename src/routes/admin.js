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

router.patch('/orders/:id/status', async (req, res, next) => {
  const id = uuid.safeParse(req.params.id);
  const status = z.enum(STATUSES).safeParse(req.body?.status);
  if (!id.success || !status.success) return res.status(400).json({ error: 'Invalid request.' });

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

    await client.query('UPDATE orders SET status = $1 WHERE id = $2', [status.data, id.data]);

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
const productSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  price: z.number().min(0).max(100000).optional(),
  stock: z.number().int().min(0).max(100000).optional(),
  size_ml: z.number().int().min(1).max(5000).optional(),
  image_url: z
    .string()
    .trim()
    .max(500)
    .regex(/^(\/|https?:\/\/)/, 'Image must start with / or https://')
    .optional()
    .or(z.literal('')),
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