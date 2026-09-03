import { Router, type Request, type Response, type RequestHandler } from 'express';
import { db, incidents, cohortStats } from '@rize/db';
import { eq, sql } from 'drizzle-orm';
import { verifyWebhookSignature } from '@rize/razorpay';
import { commitAuditBlockAtomic } from '@rize/audit-ledger';

export const webhooksRouter: Router = Router();

// Keep raw body for verification
webhooksRouter.post(
  '/razorpay',
  ((req: Request, res: Response) => {
    try {
      const signature = req.headers['x-razorpay-signature'] as string;
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_secret';

      // We assume express.raw() is configured in index.ts for this route
      const rawBody = req.body.toString();

      if (!verifyWebhookSignature(rawBody, signature, secret)) {
        res.status(401).json({ error: 'Invalid signature' });
        return; // Early return for invalid signature
      }

      const payload = JSON.parse(rawBody);
      const eventType = payload.event;

      if (
        eventType !== 'payment_link.paid' &&
        eventType !== 'payment_link.expired'
      ) {
        // Not a payment link event, but valid signature
        res.status(200).json({ status: 'ignored' });
        return;
      }

      const paymentLink = payload.payload.payment_link.entity;
      const incidentId = paymentLink.reference_id;

      if (!incidentId) {
        res.status(400).json({ error: 'Missing reference_id' });
        return;
      }

      // Important: Ensure we don't hold the connection open unnecessarily
      // In a real app this would be a background job, but we'll await it for the demo
      handleWebhookEvent(eventType, incidentId)
        .then(() => {
          // Success
        })
        .catch((error) => {
          console.error('Webhook processing error:', error);
        });

      // Always return 200 immediately to Razorpay if signature was valid
      res.status(200).json({ status: 'received' });
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ error: 'Internal error' });
    }
  }) as RequestHandler
);

/**
 * Core business logic for handling webhook events
 */
async function handleWebhookEvent(eventType: string, incidentId: string) {
  await db.transaction(async (tx) => {
    // 1. Fetch incident
    const [incident] = await tx
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!incident || incident.status !== 'EXECUTED_PENDING_SETTLEMENT') {
      return; // Already processed or not found
    }

    const isPaid = eventType === 'payment_link.paid';
    const newStatus = isPaid ? 'RECOVERED' : 'EXPIRED';

    // 2. Update Incident
    await tx
      .update(incidents)
      .set({ status: newStatus as any, updatedAt: new Date() })
      .where(eq(incidents.id, incidentId));

    // 3. Update Cohort Stats (if we know the cohort key)
    if (incident.affectedCohort) {
      if (isPaid) {
        // Increment successes and attempts
        await tx
          .update(cohortStats)
          .set({
            totalSuccesses: sql`${cohortStats.totalSuccesses} + 1`,
            totalAttempts: sql`${cohortStats.totalAttempts} + 1`,
          })
          .where(eq(cohortStats.cohortKey, incident.affectedCohort));
      } else {
        // Increment attempts only
        await tx
          .update(cohortStats)
          .set({
            totalAttempts: sql`${cohortStats.totalAttempts} + 1`,
          })
          .where(eq(cohortStats.cohortKey, incident.affectedCohort));
      }
    }

    // 4. Audit Ledger
    await commitAuditBlockAtomic(tx, {
      incidentId,
      eventType: isPaid ? 'WEBHOOK_PAID' : 'WEBHOOK_EXPIRED',
      eniScore: 0
    });
  });
}
