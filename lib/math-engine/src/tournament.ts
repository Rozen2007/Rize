import { calculateEmpiricalPRec, type CohortStats, type BayesianParams } from './bayesian.js';
import { calculateENI, type ENIParams } from './eni.js';

export type ActionType = 'DO_NOTHING' | 'PAYMENT_RECOVERY_LINK' | 'TARGETED_DYNAMIC_DISCOUNT';

export interface Candidate {
  action: ActionType;
  eligible: boolean;
  pRec: number;
  discountAmount: number;
  eni: number;
  rejectionReason?: string;
}

export interface TournamentContext {
  failureReason: string;       // PRICE_FRICTION, BANK_DECLINE, etc.
  classifierConfidence: number; // AI confidence (0.0 to 1.0)
  orderValue: number;
  device: string;              // mobile, desktop
  paymentMethod: string;       // card, upi
  grossMarginRatio: number;
  mdrRate: number;
  msgCost: number;
  minClassifierConfidence: number; // Gate: e.g., 0.80
  minMarginFloor: number;      // Post-discount margin floor
  discountCap: number;         // Max discount amount
  maxDiscountPercentage: number; // Max discount as % of order
}

export interface CohortStatMap {
  [cohortKey: string]: CohortStats;
}

export interface TournamentResult {
  winner: Candidate;
  candidates: Candidate[];
  winningENI: number;
  winningPRec: number;
}

/**
 * Determine if a discount is eligible for this failure reason
 *
 * Only PRICE_FRICTION can get a discount.
 * BANK_DECLINE, AUTH_TIMEOUT, EXPIRED_CARD → DO_NOTHING only
 */
function isDiscountEligibleByFailureReason(failureReason: string): boolean {
  return failureReason === 'PRICE_FRICTION';
}

/**
 * Determine if classifier confidence is sufficient
 */
function isClassifierConfidenceAcceptable(
  confidence: number,
  threshold: number
): boolean {
  return confidence >= threshold;
}

/**
 * Calculate max discount capped by policy and order value
 */
function calculateMaxDiscount(
  orderValue: number,
  discountCap: number,
  maxDiscountPercentage: number
): number {
  const percentageBasedCap = orderValue * maxDiscountPercentage;
  return Math.min(discountCap, percentageBasedCap);
}

/**
 * Verify that post-discount margin meets floor requirement
 */
function meetsMarginFloor(
  orderValue: number,
  discount: number,
  grossMarginRatio: number,
  mdrRate: number,
  minMarginFloor: number
): boolean {
  const grossProfit = orderValue * grossMarginRatio;
  const mdrCost = orderValue * mdrRate;
  const postDiscountMargin = (grossProfit - discount - mdrCost) / orderValue;
  return postDiscountMargin >= minMarginFloor;
}

/**
 * runInterventionTournament
 *
 * This is the main decision engine. It evaluates three candidates:
 * 1. DO_NOTHING (always eligible)
 * 2. PAYMENT_RECOVERY_LINK (if discount is ineligible)
 * 3. TARGETED_DYNAMIC_DISCOUNT (if discount is eligible AND confident)
 *
 * Returns the candidate with highest ENI.
 */
export function runInterventionTournament(
  context: TournamentContext,
  cohortStatMap?: CohortStatMap
): TournamentResult {
  const candidates: Candidate[] = [];

  // Build cohort key: device:failureReason:paymentMethod
  const cohortKey = `${context.device}:${context.failureReason}:${context.paymentMethod}`;
  const cohortStats = cohortStatMap?.[cohortKey];

  // --- CANDIDATE 1: DO_NOTHING (always eligible) ---
  const doNothingCandidate: Candidate = {
    action: 'DO_NOTHING',
    eligible: true,
    pRec: 0, // No recovery expected
    discountAmount: 0,
    eni: 0,
    rejectionReason: undefined,
  };
  candidates.push(doNothingCandidate);

  // --- CANDIDATE 2 & 3: Check discount eligibility ---
  const discountEligible =
    isDiscountEligibleByFailureReason(context.failureReason) &&
    isClassifierConfidenceAcceptable(
      context.classifierConfidence,
      context.minClassifierConfidence
    );

  if (!discountEligible) {
    const recoveryPRec = 0.15;
    const recoveryEni = calculateENI({
      orderValue: context.orderValue,
      pRec: recoveryPRec,
      discountAmount: 0,
      mdrRate: context.mdrRate,
      msgCost: context.msgCost,
      grossMarginRatio: context.grossMarginRatio,
    });

    const recoveryLinkCandidate: Candidate = {
      action: 'PAYMENT_RECOVERY_LINK',
      eligible: true,
      pRec: recoveryPRec,
      discountAmount: 0,
      eni: recoveryEni,
      rejectionReason:
        context.failureReason !== 'PRICE_FRICTION'
          ? `Cannot discount ${context.failureReason}`
          : `Classifier confidence too low (${context.classifierConfidence.toFixed(
              2
            )} < ${context.minClassifierConfidence})`,
    };
    candidates.push(recoveryLinkCandidate);

    // Return best candidate
    const winner =
      recoveryLinkCandidate.eni > doNothingCandidate.eni
        ? recoveryLinkCandidate
        : doNothingCandidate;

    return {
      winner,
      candidates,
      winningENI: winner.eni,
      winningPRec: winner.pRec,
    };
  }

  // --- DISCOUNT IS ELIGIBLE ---

  // Calculate max discount
  const maxDiscount = calculateMaxDiscount(
    context.orderValue,
    context.discountCap,
    context.maxDiscountPercentage
  );

  // Calculate P_rec for this cohort
  const pRec = calculateEmpiricalPRec({
    priorPRec: 0.72, // Default prior for PRICE_FRICTION
    N: 10,
    cohortStats,
  });

  // Calculate ENI with discount
  const eni = calculateENI({
    orderValue: context.orderValue,
    pRec,
    discountAmount: maxDiscount,
    mdrRate: context.mdrRate,
    msgCost: context.msgCost,
    grossMarginRatio: context.grossMarginRatio,
  });

  // Check margin floor
  const passesMarginFloor = meetsMarginFloor(
    context.orderValue,
    maxDiscount,
    context.grossMarginRatio,
    context.mdrRate,
    context.minMarginFloor
  );

  const discountCandidate: Candidate = {
    action: 'TARGETED_DYNAMIC_DISCOUNT',
    eligible: eni > 0 && passesMarginFloor,
    pRec,
    discountAmount: maxDiscount,
    eni: eni > 0 && passesMarginFloor ? eni : 0,
    rejectionReason: !passesMarginFloor
      ? 'Post-discount margin below floor'
      : eni <= 0
      ? 'Negative ENI'
      : undefined,
  };
  candidates.push(discountCandidate);

  // --- TOURNAMENT: SELECT WINNER ---
  let winner = doNothingCandidate;
  for (const candidate of candidates) {
    if (candidate.eligible && candidate.eni > winner.eni) {
      winner = candidate;
    }
  }

  return {
    winner,
    candidates,
    winningENI: winner.eni,
    winningPRec: winner.pRec,
  };
}
