import { app } from './apps/api/src/index.ts';
import request from 'supertest';
import 'dotenv/config';

async function run() {
  const payload = {
    merchantId: 'test',
    orderValue: 25000,
    errorCode: 'PRICE_FRICTION',
    errorDesc: 'desc',
    device: 'mobile',
    paymentMethod: 'upi',
    customerPhone: '9876543210',
    checkoutId: 'chk_' + Date.now(),
    razorpayEventId: 'ev_' + Date.now()
  };

  const res = await request(app)
    .post('/internal/ingest')
    .set('x-internal-key', 'test_internal_key_123')
    .send(payload);

  console.log(res.status);
  console.log(res.body);
}

run();
