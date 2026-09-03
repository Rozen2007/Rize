import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyWebhookSignature } from '../src/verify.js';

describe('Razorpay Wrapper', () => {
  it('1.A: Verifies valid signature', () => {
    const secret = 'webhook_secret_123';
    const payload = JSON.stringify({ event: 'payment_link.paid' });
    const signature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    const isValid = verifyWebhookSignature(payload, signature, secret);
    expect(isValid).toBe(true);
  });

  it('1.B: Rejects invalid signature', () => {
    const secret = 'webhook_secret_123';
    const payload = JSON.stringify({ event: 'payment_link.paid' });
    const signature = 'invalid_signature_hex';

    const isValid = verifyWebhookSignature(payload, signature, secret);
    expect(isValid).toBe(false);
  });
});
