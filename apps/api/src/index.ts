import 'dotenv/config';
import express from 'express';
import { webhooksRouter } from './routes/webhooks';

export const app = express();
const port = process.env.PORT || 3000;

app.use('/webhooks', webhooksRouter);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
