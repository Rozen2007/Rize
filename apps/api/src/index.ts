import 'dotenv/config';
import express from 'express';
import { webhooksRouter } from './routes/webhooks';
import { ingestRouter } from './routes/ingest';

export const app = express();
const port = process.env.PORT || 3000;

app.use(express.json()); // Add json parser for ingest route
app.use('/webhooks', webhooksRouter);
app.use('/internal/ingest', ingestRouter);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
