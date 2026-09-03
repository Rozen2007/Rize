import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db, incidents, cohortStats, auditLedger } from '@rize/db';
import { eq } from 'drizzle-orm';
import { verifyWebhookSignature } from '@rize/razorpay';
import crypto from 'crypto';

describe('Webhook Handler', () => {
  const WEBHOOK_SECRET = 'test_webhook_secret';

  describe('Signature Verification', () => {
    it('Valid signature should verify', () => {
      const body = Buffer.from(JSON.stringify({ event: 'payment_link.paid' }));
      const signature = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(body)
        .digest('hex');

      expect(verifyWebhookSignature(body.toString(), signature, WEBHOOK_SECRET)).toBe(true);
    });

    it('Invalid signature should fail', () => {
      const body = Buffer.from(JSON.stringify({ event: 'payment_link.paid' }));
      const invalidSignature = 'invalid_signature';

      expect(verifyWebhookSignature(body.toString(), invalidSignature, WEBHOOK_SECRET)).toBe(false);
    });
  });
});
