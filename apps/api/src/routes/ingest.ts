import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import seedrandom from 'seedrandom';
import { db, incidents, cohortStats } from '@rize/db';
import { eq, and } from 'drizzle-orm';
import { classifyFailureWithTimeout, generateCopyWithTimeout } from '@rize/ai';
import { runInterventionTournament, ContextInput, FailureReason } from '@rize/math-engine';
import { createPaymentLink } from '@rize/razorpay';
import { commitAuditBlockAtomic } from '@rize/audit-ledger';

export const ingestRouter = Router();

// Zod schema for input validation
const ingestSchema = z.object({
  merchantId: z.string(),
  orderValue: z.number().positive(),
  errorCode: z.string(),
  errorDesc: z.string(),
  device: z.string(),
  paymentMethod: z.string(),
  customerPhone: z.string().optional(),
  checkoutId: z.string(),
  razorpayEventId: z.string(),
  // For demo/testing purposes
  mockMerchantConfig: z.object({
    grossMarginRatio: z.number(),
    mdrRate: z.number(),
    maxDiscountCap: z.number(),
    minMarginFloor: z.number(),
    controlGroupRatio: z.number(),
    minClassifierConfidence: z.number().default(0.8)
  }).optional()
});

function shouldAssignToControl(
  merchantId: string,
  controlGroupRatio: number,
  seed?: string
): boolean {
  const random = seed ? seedrandom(seed)() : Math.random();
  return random < controlGroupRatio;
}

ingestRouter.post('/', async (req: Request, res: Response) => {
  try {
    // 1. Auth Check (timingSafeEqual + length check)
    const providedKey = req.headers['x-internal-key'] as string;
    const expectedKey = process.env.INTERNAL_API_KEY || 'demo_key'; // Default for demo

    if (!providedKey || !expectedKey) {
      return res.status(401).json({ error: 'Missing credentials' });
    }

    const providedBuffer = Buffer.from(providedKey, 'utf8');
    const expectedBuffer = Buffer.from(expectedKey, 'utf8');

    if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 2. Validate payload
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.format() });
    }

    const data = parsed.data;
    const incidentId = `inc_${crypto.randomUUID()}`;

    // For demo, we pass mock config in payload if not fetching from DB
    const merchantConfig = data.mockMerchantConfig || {
      grossMarginRatio: 0.40,
      mdrRate: 0.02,
      maxDiscountCap: 0.15,
      minMarginFloor: 0.10,
      controlGroupRatio: 0.10,
      minClassifierConfidence: 0.8
    };

    // Cohort key (device:failureReason:paymentMethod)
    // Wait, failureReason is determined by AI. We will generate the cohort key AFTER AI classification.

    await db.transaction(async (tx) => {
      // Step 1: Missing Contact
      if (!data.customerPhone) {
        await tx.insert(incidents).values({
          id: incidentId,
          merchantId: data.merchantId,
          razorpayEventId: data.razorpayEventId,
          checkoutId: data.checkoutId,
          orderValue: data.orderValue,
          failureReason: 'AUTH_TIMEOUT', // dummy since we skip early
          device: data.device,
          paymentMethod: data.paymentMethod,
          affectedCohort: 'UNKNOWN',
          winningAction: 'DO_NOTHING',
          winningENI: 0,
          winningPRec: 0,
          candidatesJson: '[]',
          status: 'SKIPPED_MISSING_CONTACT',
          updatedAt: new Date()
        });
        await commitAuditBlockAtomic(tx, {
          incidentId,
          eventType: 'SKIPPED_MISSING_CONTACT',
          eniScore: 0
        });
        return;
      }

      // Step 2: Classify Failure (AI)
      const { reason: failureReason, confidence: classifierConfidence } = await classifyFailureWithTimeout(data.errorCode, data.errorDesc);
      
      const cohortKey = `${data.device}:${failureReason}:${data.paymentMethod}`;

      // Step 3: Control Group Assignment
      const isControl = shouldAssignToControl(
        data.merchantId,
        merchantConfig.controlGroupRatio,
        process.env.NODE_ENV === 'test' ? 'test-seed-123' : data.checkoutId
      );

      if (isControl) {
        await tx.insert(incidents).values({
          id: incidentId,
          merchantId: data.merchantId,
          razorpayEventId: data.razorpayEventId,
          checkoutId: data.checkoutId,
          customerPhone: data.customerPhone,
          orderValue: data.orderValue,
          failureReason: failureReason as FailureReason,
          device: data.device,
          paymentMethod: data.paymentMethod,
          affectedCohort: cohortKey,
          isControl: true,
          winningAction: 'DO_NOTHING',
          winningENI: 0,
          winningPRec: 0,
          candidatesJson: '[]',
          status: 'CONTROL_HELDOUT',
          updatedAt: new Date()
        });
        await commitAuditBlockAtomic(tx, {
          incidentId,
          eventType: 'CONTROL_HELDOUT',
          eniScore: 0
        });
        return;
      }

      // Step 4: Run Tournament
      // Load cohort stats
      const statsList = await tx.select().from(cohortStats).where(
        and(
          eq(cohortStats.merchantId, data.merchantId),
          eq(cohortStats.cohortKey, cohortKey)
        )
      );

      const cohortStatsMap: Record<string, { totalAttempts: number; totalSuccesses: number }> = {};
      statsList.forEach(s => {
        cohortStatsMap[s.actionType] = { totalAttempts: s.totalAttempts, totalSuccesses: s.totalSuccesses };
      });

      const ctxInput: ContextInput = {
        orderValue: data.orderValue,
        failureReason: failureReason as FailureReason,
        classifierConfidence,
        grossMarginRatio: merchantConfig.grossMarginRatio,
        mdrRate: merchantConfig.mdrRate,
        maxDiscountCap: merchantConfig.maxDiscountCap,
        minMarginFloor: merchantConfig.minMarginFloor,
        minClassifierConfidence: merchantConfig.minClassifierConfidence
      };

      const tournamentResult = runInterventionTournament(ctxInput, cohortStatsMap);
      const winner = tournamentResult.winner;

      // Step 5: Policy Gate
      // runInterventionTournament already applies margin floor, but we add defense in depth
      let finalStatus: typeof incidents.$inferInsert.status = 'EXECUTING';
      let eventTypeStr = 'ACTION_EXECUTED';
      
      const grossProfit = data.orderValue * merchantConfig.grossMarginRatio;
      const postDiscountMargin = (grossProfit - winner.discount) / data.orderValue;
      
      if (postDiscountMargin < merchantConfig.minMarginFloor) {
        finalStatus = 'BLOCKED_INSUFFICIENT_MARGIN';
        eventTypeStr = 'ACTION_BLOCKED_POLICY';
      } else if (winner.action === 'DO_NOTHING') {
        finalStatus = 'PENDING'; // Or a specific DO_NOTHING state if defined, usually we just leave it or mark a terminal state, let's use EXPIRED or PENDING
        eventTypeStr = 'DO_NOTHING_CHOSEN';
      }

      // Step 6: Action Execution
      let razorpayLinkId = undefined;
      let razorpayLinkUrl = undefined;

      if (finalStatus === 'EXECUTING' && winner.action !== 'DO_NOTHING') {
        // AI Copy Generation
        const copyMsg = await generateCopyWithTimeout(winner.action, data.orderValue - winner.discount);
        
        // Execute real action
        try {
          const linkResult = await createPaymentLink(
            incidentId,
            data.orderValue,
            winner.discount,
            data.customerPhone
          );
          razorpayLinkId = linkResult.id;
          razorpayLinkUrl = linkResult.short_url;
          finalStatus = 'EXECUTED_PENDING_SETTLEMENT';
        } catch (e: any) {
          console.error('Razorpay link creation failed:', e);
          // Don't mark as executed
          throw e; // Rolls back transaction
        }
      } else if (finalStatus === 'EXECUTING' && winner.action === 'DO_NOTHING') {
         finalStatus = 'PENDING';
      }

      // Step 7: Persist Candidate JSON and Audit
      await tx.insert(incidents).values({
        id: incidentId,
        merchantId: data.merchantId,
        razorpayEventId: data.razorpayEventId,
        checkoutId: data.checkoutId,
        customerPhone: data.customerPhone,
        orderValue: data.orderValue,
        failureReason: failureReason as FailureReason,
        device: data.device,
        paymentMethod: data.paymentMethod,
        affectedCohort: cohortKey,
        isControl: false,
        winningAction: winner.action,
        winningENI: winner.eni,
        winningPRec: winner.pRec,
        discountOffered: winner.discount,
        candidatesJson: JSON.stringify(tournamentResult),
        rejectionReason: winner.rejectionReason,
        razorpayLinkId,
        razorpayLinkUrl,
        status: finalStatus,
        updatedAt: new Date()
      });

      await commitAuditBlockAtomic(tx, {
        incidentId,
        eventType: eventTypeStr,
        eniScore: winner.eni
      });
    });

    return res.status(200).json({ status: 'ok', incidentId: 'created' });
  } catch (error: any) {
    console.error('Ingest processing error:', error);
    // Explicit transaction rollback on Razorpay failure or other exceptions
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});
