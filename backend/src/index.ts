import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import recipesRouter from './routes/recipes';
import profileRouter from './routes/profile';
import plannerRouter from './routes/planner';
import sourcesRouter from './routes/sources';
import searchRouter from './routes/search';
import { initDb } from './db';

// ─── DB init — starts immediately, awaited by middleware before first request ──

const dbReady = initDb();

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express();
const PORT = parseInt(process.env['PORT'] || '3001', 10);

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Gate all requests until DB schema/seed is ready
app.use((_req, _res, next) => {
  dbReady.then(() => next()).catch(next);
});

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/recipes', recipesRouter);
app.use('/api/profile', profileRouter);
app.use('/api/plans', plannerRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/search', searchRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0', db: 'neon-postgres' });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Local startup only (skipped on Vercel) ───────────────────────────────────

if (!process.env['VERCEL']) {
  dbReady.then(() => {
    app.listen(PORT, () => {
      console.log('\x1b[32m');
      console.log('  ╔════════════════════════════════════════╗');
      console.log('  ║   🍽  MealMind API  v1.0.0              ║');
      console.log('  ║   Node.js / Express / Neon PostgreSQL  ║');
      console.log('  ╚════════════════════════════════════════╝');
      console.log('\x1b[0m');
      console.log(`  Server: http://localhost:${PORT}/api\n`);
    });
  }).catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
}

export default app;
