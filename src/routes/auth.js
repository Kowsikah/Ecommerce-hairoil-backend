import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { createUser, findByEmail } from '../models/users.js';
import { adminUser, envAdminMatches, isAdminEmail, requireAuth, signEnvAdminToken, signToken } from '../middleware/adminAuth.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name.').max(100, 'Name is too long.'),
  email: z.string().trim().toLowerCase().max(254).email('Please enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(72, 'Password must be 72 characters or fewer.'),
});
const loginSchema = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

const DUPLICATE = 'An account with this email already exists. Try logging in.';
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12); // keeps timing similar for unknown emails
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

router.post('/signup', limiter, async (req, res, next) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { name, email, password } = parsed.data;

    if (isAdminEmail(email) || (await findByEmail(email))) return res.status(409).json({ error: DUPLICATE });

    // New accounts are ALWAYS customers. Admin is granted only from the database.
    const user = await createUser({ name, email, passwordHash: await bcrypt.hash(password, 12) });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: DUPLICATE });
    next(err);
  }
});

router.post('/login', limiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter your email and password.' });
    const { email, password } = parsed.data;

    // Admin login: exact email + password from .env
    if (envAdminMatches(email, password)) {
      return res.json({ token: signEnvAdminToken(), user: adminUser() });
    }

    const user = await findByEmail(email);
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) return res.status(401).json({ error: 'Incorrect email or password.' });

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

export default router;
