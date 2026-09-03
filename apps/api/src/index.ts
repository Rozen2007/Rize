import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import express, { type Express } from 'express';
import { webhooksRouter } from './routes/webhooks.js';
import { ingestRouter } from './routes/ingest.js';
import { metricsRouter } from './routes/metrics.js';
import { incidentsRouter } from './routes/incidents.js';

export const app: Express = express();
const port = process.env.PORT || 3000;

app.use('/webhooks', express.raw({ type: 'application/json' }), webhooksRouter);
app.use(express.json()); // Add json parser for other routes
app.use('/internal/ingest', ingestRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/incidents', incidentsRouter);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
