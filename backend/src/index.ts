import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import recipesRouter from './routes/recipes';
import profileRouter from './routes/profile';
import plannerRouter from './routes/planner';
import sourcesRouter from './routes/sources';
import { initDb } from './db';

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

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/recipes', recipesRouter);
app.use('/api/profile', profileRouter);
app.use('/api/plans', plannerRouter);
app.use('/api/sources', sourcesRouter);

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

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start() {
  try {
    await initDb();
    app.listen(PORT, () => {
      printBanner();
      console.log(`\n  Server running on http://localhost:${PORT}`);
      console.log(`  API base:    http://localhost:${PORT}/api`);
      console.log(`  Health:      http://localhost:${PORT}/api/health`);
      console.log(`  Frontend:    http://localhost:5173\n`);
    });
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }
}

function printBanner(): void {
  console.log('\x1b[32m');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║                                       ║');
  console.log('  ║   🍽  MealMind API  v1.0.0             ║');
  console.log('  ║                                       ║');
  console.log('  ║   Node.js / Express / TypeScript      ║');
  console.log('  ║   Neon PostgreSQL                     ║');
  console.log('  ║                                       ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('\x1b[0m');
}

start();
export default app;
