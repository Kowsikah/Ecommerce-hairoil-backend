import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

// GET /api/products
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM products WHERE is_active = true ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/products/:slug
router.get('/:slug', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM products WHERE slug = $1 AND is_active = true',
      [req.params.slug]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

export default router;