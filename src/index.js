import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import productRoutes from './routes/products.js';
import adminRoutes from './routes/admin.js';
import orderRoutes from './routes/order.js';
import authRoutes from './routes/auth.js'; // <-- NEW: login / signup
import chatRoutes from './routes/chat.js'; // <-- Groq chatbot
import { publicTracking } from './routes/tracking.js'; // <-- order tracking

const app = express();
const allowedOrigins = [
  process.env.CLIENT_URL,
  'https://beinlovehairoil.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
] // removes undefined entries

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if the incoming origin matches or matches without a trailing slash
    const isAllowed = allowedOrigins.some(allowed => 
      origin === allowed || origin === allowed.replace(/\/$/, '')
    );

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
// NEW: needed on Render/Railway/Heroku so the login rate limiter sees real visitor IPs
app.set('trust proxy', 1);

app.use(helmet());
app.use(express.json());
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.send('Server is up and running!');
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/chat', chatRoutes); // <-- chatbot
app.use('/api/auth', authRoutes); // <-- NEW
app.use('/api/products', productRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/orders', publicTracking); // POST /api/orders/track (before orderRoutes)
app.use('/api/orders', orderRoutes);

// 404 + error handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 API running on http://localhost:${PORT}`)
);
