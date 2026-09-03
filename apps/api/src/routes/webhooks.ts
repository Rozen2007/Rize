import { Router } from 'express';
import express from 'express';
import crypto from 'crypto';
import { db, incidents, processedWebhookEvents } from '@rize/db';
import { eq } from 'drizzle-orm';

export const webhooksRouter: Router = Router();

// Mount with raw body parser to preserve exact bytes for HMAC validation
webhooksRouter.post('/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'] as string;
    const eventId = req.headers['x-razorpay-event-id'] as string;
    
    if (!signature || !eventId) {
      return res.status(400).json({ error: 'Missing required Razorpay headers' });
    }

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
    if (!secret) {
      console.error('RAZORPAY_WEBHOOK_SECRET is not set');
      return res.status(500).json({ error: 'Internal server error' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(req.body)
      .digest('hex');

    // Constant-time comparison
    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const payload = JSON.parse(req.body.toString('utf8'));

    // Transaction to ensure atomicity of idempotency and state update
    await db.transaction(async (tx) => {
      // Deduplicate using processedWebhookEvents
      const existing = await tx.select().from(processedWebhookEvents).where(eq(processedWebhookEvents.eventId, eventId));
      if (existing.length > 0) {
        // Event already processed, just return 200
        return;
      }

      await tx.insert(processedWebhookEvents).values({
        eventId,
        eventType: payload.event,
      });

      if (payload.event === 'payment_link.paid') {
        const linkId = payload.payload.payment_link.entity.id;
        
        // Find matching incident
        const matchingIncidentList = await tx.select().from(incidents).where(eq(incidents.razorpayLinkId, linkId));
        const incident = matchingIncidentList[0];
        if (incident) {
          // Flip incident to RECOVERED
          await tx.update(incidents)
            .set({ status: 'RECOVERED', updatedAt: new Date() })
            .where(eq(incidents.id, incident.id));
        } else {
          console.log(`Webhook received for unassociated payment link: ${linkId}`);
        }
      }
    });

    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
