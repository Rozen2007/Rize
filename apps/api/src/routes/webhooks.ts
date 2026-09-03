import { Router, Request, Response } from 'express';
import express from 'express';
import { db, incidents, processedWebhookEvents } from '@rize/db';
import { eq } from 'drizzle-orm';
import { verifyWebhookSignature } from '@rize/razorpay';
import { commitAuditBlockAtomic } from '@rize/audit-ledger';

export const webhooksRouter: Router = Router();

// Define terminal states that shouldn't be transitioned out of
const TERMINAL_STATES = ['RECOVERED', 'EXPIRED', 'SKIPPED_MISSING_CONTACT', 'CONTROL_HELDOUT', 'BLOCKED_INSUFFICIENT_MARGIN'];

// 1. Mount raw body parser first to preserve exact bytes for HMAC validation
webhooksRouter.post('/razorpay', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const rawBody = req.body;
    
    // 2. Extract signature and event ID
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

    // 3. Verify signature using @rize/razorpay SDK wrapper
    const rawBodyString = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const isValid = verifyWebhookSignature(rawBodyString, signature, secret);

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // 4. Safely parse JSON payload
    let payload: any;
    try {
      payload = JSON.parse(rawBodyString);
    } catch (e) {
      return res.status(400).json({ error: 'Malformed JSON payload' });
    }

    // 5. Atomic transaction for idempotency and state updates
    await db.transaction(async (tx) => {
      // Enforce robust idempotency using onConflictDoNothing
      const insertResult = await tx.insert(processedWebhookEvents)
        .values({
          eventId,
          eventType: payload.event,
        })
        .onConflictDoNothing();
      
      // Check if rows were inserted. If 0, it was a conflict (duplicate event ID).
      if (insertResult.rowCount === 0) {
        console.log(`Ignoring duplicate webhook eventId: ${eventId}`);
        return; // Exits transaction block cleanly
      }

      // 6. Defensively extract incidentId from the payload notes
      const incidentId = payload.payload?.payment_link?.entity?.notes?.incidentId;
      if (!incidentId) {
        console.warn(`Webhook missing incidentId in notes for eventId: ${eventId}`);
        return; // Ack and return 200 via transaction exit
      }

      // Lookup the incident
      const incidentList = await tx.select().from(incidents).where(eq(incidents.id, incidentId));
      const incident = incidentList[0];

      if (!incident) {
        console.error(`Webhook incident not found: ${incidentId}`);
        return; // Ack and return 200 via transaction exit
      }

      // Check if already in a terminal state
      if (incident.status && TERMINAL_STATES.includes(incident.status)) {
        console.log(`Skipping update for incident ${incidentId}, already in terminal state: ${incident.status}`);
        return; // Ack and return 200 via transaction exit
      }

      // 7. Event Mapping
      let newState: typeof incidents.$inferInsert.status | null = null;
      if (payload.event === 'payment_link.paid') {
        newState = 'RECOVERED';
      } else if (payload.event === 'payment_link.expired' || payload.event === 'payment_link.cancelled') {
        newState = 'EXPIRED';
      }

      if (newState) {
        // Update incident state
        await tx.update(incidents)
          .set({ status: newState, updatedAt: new Date() })
          .where(eq(incidents.id, incident.id));

        // 8. Write an audit block atomically using the original winning ENI
        await commitAuditBlockAtomic(tx, {
          incidentId: incident.id,
          eventType: newState,
          eniScore: incident.winningENI || 0,
        });
      }
    });

    // 9. Return success
    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
