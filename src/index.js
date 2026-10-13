import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import productRoutes from './routes/products.js';
import adminRoutes from './routes/admin.js';
import orderRoutes from './routes/order.js';
import authRoutes from './routes/auth.js'; // <-- NEW: login / signup

const app = express();

// NEW: needed on Render/Railway/Heroku so the login rate limiter sees real visitor IPs
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.send('Server is up and running!');
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes); // <-- NEW
app.use('/api/products', productRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/orders', orderRoutes);

// 404 + error handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(process.env.PORT, () =>
  console.log(`🚀 API running on http://localhost:${process.env.PORT}`)
);