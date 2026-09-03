import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/index';
import crypto from 'crypto';
import { db, incidents, processedWebhookEvents } from '@rize/db';
import { eq } from 'drizzle-orm';

describe('POST /webhooks/razorpay', () => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_secret_123';
  process.env.RAZORPAY_WEBHOOK_SECRET = secret;

  const validPayload = {
    entity: "event",
    event: "payment_link.paid",
    contains: ["payment", "payment_link"],
    payload: {
      payment_link: {
        entity: {
          id: "plink_test_123",
          reference_id: "inc_test_webhook"
        }
      }
    }
  };

  const payloadString = JSON.stringify(validPayload);
  const validSignature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');

  beforeAll(async () => {
    // Setup test incident
    await db.insert(incidents).values({
      id: 'inc_test_webhook',
      merchantId: 'merchant_test_123',
      razorpayEventId: 'evt_test_setup',
      checkoutId: 'chk_test',
      orderValue: 500,
      failureReason: 'PRICE_FRICTION',
      device: 'desktop',
      paymentMethod: 'card',
      affectedCohort: 'Desktop:PRICE_FRICTION:Card',
      isControl: false,
      winningAction: 'PAYMENT_RECOVERY_LINK',
      winningENI: 15,
      winningPRec: 0.1,
      candidatesJson: '{}',
      razorpayLinkId: 'plink_test_123',
      status: 'PENDING'
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(processedWebhookEvents).where(eq(processedWebhookEvents.eventId, 'evt_test_valid'));
    await db.delete(incidents).where(eq(incidents.id, 'inc_test_webhook'));
  });

  it('10.A: POST with a wrong signature -> 400, zero DB change', async () => {
    const invalidSignature = crypto.createHmac('sha256', 'wrong_secret').update(payloadString).digest('hex');
    
    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('x-razorpay-signature', invalidSignature)
      .set('x-razorpay-event-id', 'evt_test_invalid')
      .set('content-type', 'application/json')
      .send(payloadString);

    expect(res.status).toBe(400);

    const events = await db.select().from(processedWebhookEvents).where(eq(processedWebhookEvents.eventId, 'evt_test_invalid'));
    expect(events.length).toBe(0);
  });

  it('10.B: POST the same valid webhook twice -> second is ignored, processed once', async () => {
    const eventId = 'evt_test_valid';

    // First request
    const res1 = await request(app)
      .post('/webhooks/razorpay')
      .set('x-razorpay-signature', validSignature)
      .set('x-razorpay-event-id', eventId)
      .set('content-type', 'application/json')
      .send(payloadString);

    expect(res1.status).toBe(200);

    // Verify incident updated
    const inc = await db.select().from(incidents).where(eq(incidents.id, 'inc_test_webhook'));
    expect(inc[0].status).toBe('RECOVERED');

    // Second request (duplicate)
    const res2 = await request(app)
      .post('/webhooks/razorpay')
      .set('x-razorpay-signature', validSignature)
      .set('x-razorpay-event-id', eventId)
      .set('content-type', 'application/json')
      .send(payloadString);

    expect(res2.status).toBe(200);

    // Verify it was only processed once
    const events = await db.select().from(processedWebhookEvents).where(eq(processedWebhookEvents.eventId, eventId));
    expect(events.length).toBe(1);
  });
});
