import { calculateEmpiricalPRec } from './bayesian.js';

export type ActionType = 'PAYMENT_RECOVERY_LINK' | 'TARGETED_DYNAMIC_DISCOUNT' | 'DO_NOTHING';
export type FailureReason = 'PRICE_FRICTION' | 'BANK_DECLINE' | 'AUTH_TIMEOUT' | 'EXPIRED_CARD';

export interface ContextInput {
  orderValue: number;
  failureReason: FailureReason;
  grossMarginRatio: number;
  mdrRate: number;
  maxDiscountCap: number;
  minMarginFloor: number;
  
  // Extra fields for compatibility with existing tests/ingest (will be ignored or mapped)
  device?: string;
  paymentMethod?: string;
  classifierConfidence?: number;
  minClassifierConfidence?: number;
  msgCost?: number;
  discountCap?: number;
  maxDiscountPercentage?: number;
}

export interface Candidate {
  type: ActionType;
  pRecovery: number;
  discountAmount: number;
  msgCost: number;
  eni: number;
  eligible: boolean;
  note: string;
}

export interface TournamentResult {
  winner: Candidate;
  candidates: Candidate[];
  rejectionExplanation: string;
}

export function runInterventionTournament(
  ctx: ContextInput,
  cohortStatsMap?: Record<string, { totalAttempts: number; totalSuccesses: number }>
): TournamentResult {
  // Support either maxDiscountCap or maxDiscountPercentage for compatibility
  const discountCapPct = ctx.maxDiscountCap ?? ctx.maxDiscountPercentage ?? 0.15;
  
  const grossProfit = ctx.orderValue * ctx.grossMarginRatio;
  const mdrCost = ctx.orderValue * ctx.mdrRate;
  const DO_NOTHING: Candidate = { type: 'DO_NOTHING', pRecovery: 0, discountAmount: 0, msgCost: 0, eni: 0, eligible: true, note: 'Safe floor' };

  if (ctx.grossMarginRatio < ctx.minMarginFloor) {
    return { winner: DO_NOTHING, candidates: [DO_NOTHING],
      rejectionExplanation: `Gross margin ${(ctx.grossMarginRatio*100).toFixed(1)}% below floor ${(ctx.minMarginFloor*100).toFixed(1)}% — all interventions blocked.` };
  }

  const candidates: Candidate[] = [];

  const pLink = calculateEmpiricalPRec('PAYMENT_RECOVERY_LINK', ctx.failureReason, cohortStatsMap?.['PAYMENT_RECOVERY_LINK']);
  candidates.push({ type: 'PAYMENT_RECOVERY_LINK', pRecovery: pLink, discountAmount: 0, msgCost: 1.5,
    eni: pLink * (grossProfit - mdrCost) - 1.5, eligible: true, note: 'Retry link, no margin cost' });

  // Discount eligible ONLY for PRICE_FRICTION (Blocker #4)
  const discountEligible = ctx.failureReason === 'PRICE_FRICTION';
  const discount = Math.min(ctx.orderValue * discountCapPct, grossProfit * 0.40);
  const pDisc = discountEligible ? calculateEmpiricalPRec('TARGETED_DYNAMIC_DISCOUNT', ctx.failureReason, cohortStatsMap?.['TARGETED_DYNAMIC_DISCOUNT']) : 0;
  candidates.push({ type: 'TARGETED_DYNAMIC_DISCOUNT', pRecovery: pDisc, discountAmount: discount, msgCost: 2.0,
    eni: discountEligible ? pDisc * (grossProfit - discount - mdrCost) - 2.0 : Number.NEGATIVE_INFINITY,
    eligible: discountEligible, note: discountEligible ? 'Price-driven failure' : 'Ineligible: technical failure, discount cannot fix cause' });

  candidates.push(DO_NOTHING);

  const ranked = [...candidates].sort((a, b) => b.eni - a.eni);
  const winner = ranked[0];
  const runnerUp = ranked.find(c => c.type !== winner.type)!;
  const rejectionExplanation = winner.type === 'DO_NOTHING'
    ? 'All eligible interventions had non-positive expected net profit.'
    : `Selected ${winner.type} (ENI ₹${winner.eni.toFixed(2)}, P_rec ${(winner.pRecovery*100).toFixed(0)}%) over ${runnerUp.type} (ENI ${runnerUp.eni===Number.NEGATIVE_INFINITY?'ineligible':'₹'+runnerUp.eni.toFixed(2)}).`;
  return { winner, candidates, rejectionExplanation };
}
