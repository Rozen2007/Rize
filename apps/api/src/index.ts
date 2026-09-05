import dotenv from 'dotenv';
import path from 'path';
// Only load .env file in local development - Railway/Vercel inject env vars directly
if (process.env.NODE_ENV !== 'production' && !process.env.RAILWAY_ENVIRONMENT && !process.env.VERCEL) {
  dotenv.config();
  if (!process.env.DATABASE_URL) {
    dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
  }
}

import express, { type Express } from 'express';
import { webhooksRouter } from './routes/webhooks.js';
import { ingestRouter } from './routes/ingest.js';
import { metricsRouter } from './routes/metrics.js';
import { incidentsRouter } from './routes/incidents.js';

export const app: Express = express();
const port = process.env.PORT || 3000;

app.use('/webhooks', express.raw({ type: 'application/json' }), webhooksRouter);
app.use(express.json()); // Add json parser for other routes

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use('/internal/ingest', ingestRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/incidents', incidentsRouter);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}
