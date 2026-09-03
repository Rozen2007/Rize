export type FailureReason = 'PRICE_FRICTION' | 'BANK_DECLINE' | 'AUTH_TIMEOUT' | 'EXPIRED_CARD';
export type ActionType = 'PAYMENT_RECOVERY_LINK' | 'TARGETED_DYNAMIC_DISCOUNT' | 'DO_NOTHING';

export interface ContextInput {
  orderValue: number;
  failureReason: FailureReason;
  classifierConfidence: number;
  grossMarginRatio: number;
  mdrRate: number;
  maxDiscountCap: number;
  minMarginFloor: number;
  minClassifierConfidence: number;
}

export interface Candidate {
  action: ActionType;
  eligible: boolean;
  pRec: number;
  discount: number;
  msgCost: number;
  eni: number;
  rejectionReason: string;
}

export interface TournamentResult {
  winner: Candidate;
  candidates: Candidate[];
}

export function calculateEmpiricalPRec(
  actionType: ActionType,
  failureReason: FailureReason,
  stats?: { totalAttempts: number; totalSuccesses: number }
): number {
  const alpha = 2, beta = 5;
  if (!stats || stats.totalAttempts === 0) {
    if (actionType === 'TARGETED_DYNAMIC_DISCOUNT') return 0.70; // only ever called for PRICE_FRICTION
    return failureReason === 'PRICE_FRICTION' ? 0.35 : 0.55;
  }
  return (stats.totalSuccesses + alpha) / (stats.totalAttempts + alpha + beta);
}

export function runInterventionTournament(
  ctx: ContextInput,
  cohortStatsMap?: Record<string, { totalAttempts: number; totalSuccesses: number }>
): TournamentResult {
  const grossProfit = ctx.orderValue * ctx.grossMarginRatio;
  const mdrCost = ctx.orderValue * ctx.mdrRate;
  const DO_NOTHING: Candidate = {
    action: 'DO_NOTHING',
    eligible: true,
    pRec: 0,
    discount: 0,
    msgCost: 0,
    eni: 0,
    rejectionReason: 'Safe floor',
  };

  if (ctx.grossMarginRatio < ctx.minMarginFloor) {
    const reason = `Gross margin ${(ctx.grossMarginRatio * 100).toFixed(1)}% below floor ${(ctx.minMarginFloor * 100).toFixed(1)}% — all interventions blocked.`;
    DO_NOTHING.rejectionReason = reason;
    return { 
      winner: DO_NOTHING, 
      candidates: [
        { action: 'PAYMENT_RECOVERY_LINK', eligible: false, pRec: 0, discount: 0, msgCost: 0, eni: Number.NEGATIVE_INFINITY, rejectionReason: reason },
        { action: 'TARGETED_DYNAMIC_DISCOUNT', eligible: false, pRec: 0, discount: 0, msgCost: 0, eni: Number.NEGATIVE_INFINITY, rejectionReason: reason },
        DO_NOTHING
      ] 
    };
  }

  const candidates: Candidate[] = [];

  // PAYMENT_RECOVERY_LINK is always eligible
  const pLink = calculateEmpiricalPRec('PAYMENT_RECOVERY_LINK', ctx.failureReason, cohortStatsMap?.['PAYMENT_RECOVERY_LINK']);
  const linkEni = pLink * (grossProfit - mdrCost) - 1.5;
  candidates.push({
    action: 'PAYMENT_RECOVERY_LINK',
    eligible: linkEni > 0,
    pRec: pLink,
    discount: 0,
    msgCost: 1.5,
    eni: linkEni > 0 ? linkEni : Number.NEGATIVE_INFINITY,
    rejectionReason: linkEni > 0 ? 'Eligible' : 'Negative expected net profit',
  });

  // TARGETED_DYNAMIC_DISCOUNT eligibility logic
  let discountEligible = true;
  let discountRejectionReason = 'Eligible';

  if (ctx.failureReason !== 'PRICE_FRICTION') {
    discountEligible = false;
    discountRejectionReason = 'Ineligible: technical failure, discount cannot fix cause';
  } else if (ctx.classifierConfidence < ctx.minClassifierConfidence) {
    discountEligible = false;
    discountRejectionReason = `Ineligible: classifier confidence ${(ctx.classifierConfidence * 100).toFixed(1)}% below threshold ${(ctx.minClassifierConfidence * 100).toFixed(1)}%`;
  }

  const discountAmount = Math.min(ctx.orderValue * ctx.maxDiscountCap, grossProfit * 0.40);
  const postDiscountMargin = (grossProfit - discountAmount) / ctx.orderValue;

  if (discountEligible && postDiscountMargin < ctx.minMarginFloor) {
    discountEligible = false;
    discountRejectionReason = `Ineligible: post-discount margin ${(postDiscountMargin * 100).toFixed(1)}% would breach floor ${(ctx.minMarginFloor * 100).toFixed(1)}%`;
  }

  const pDisc = discountEligible ? calculateEmpiricalPRec('TARGETED_DYNAMIC_DISCOUNT', ctx.failureReason, cohortStatsMap?.['TARGETED_DYNAMIC_DISCOUNT']) : 0;
  let discountEni = discountEligible ? pDisc * (grossProfit - discountAmount - mdrCost) - 2.0 : Number.NEGATIVE_INFINITY;

  if (discountEligible && discountEni <= 0) {
    discountEligible = false;
    discountEni = Number.NEGATIVE_INFINITY;
    discountRejectionReason = 'Negative expected net profit';
  }

  candidates.push({
    action: 'TARGETED_DYNAMIC_DISCOUNT',
    eligible: discountEligible,
    pRec: pDisc,
    discount: discountAmount,
    msgCost: 2.0,
    eni: discountEni,
    rejectionReason: discountRejectionReason,
  });

  candidates.push(DO_NOTHING);

  // Pick the winner
  const ranked = [...candidates].sort((a, b) => b.eni - a.eni);
  const winner = ranked[0];

  return { winner, candidates };
}
