import { describe, it, expect } from 'vitest';
import { calculateEmpiricalPRec, runInterventionTournament, ContextInput, FailureReason } from '../src/index';

describe('calculateEmpiricalPRec', () => {
  it('8.D Bayesian P_rec calculation', () => {
    // alpha=2, beta=5
    // P = (successes + alpha) / (attempts + alpha + beta)
    const p = calculateEmpiricalPRec('PAYMENT_RECOVERY_LINK', 'BANK_DECLINE', { totalAttempts: 10, totalSuccesses: 5 });
    // (5 + 2) / (10 + 2 + 5) = 7 / 17
    expect(p).toBeCloseTo(7 / 17);
  });

  it('8.L Zero attempts -> prior is used', () => {
    const p1 = calculateEmpiricalPRec('TARGETED_DYNAMIC_DISCOUNT', 'PRICE_FRICTION', { totalAttempts: 0, totalSuccesses: 0 });
    expect(p1).toBe(0.70);

    const p2 = calculateEmpiricalPRec('PAYMENT_RECOVERY_LINK', 'PRICE_FRICTION', { totalAttempts: 0, totalSuccesses: 0 });
    expect(p2).toBe(0.35);

    const p3 = calculateEmpiricalPRec('PAYMENT_RECOVERY_LINK', 'BANK_DECLINE');
    expect(p3).toBe(0.55);
  });
});

describe('runInterventionTournament', () => {
  const getBaseCtx = (overrides?: Partial<ContextInput>): ContextInput => ({
    orderValue: 1000,
    failureReason: 'PRICE_FRICTION',
    classifierConfidence: 0.95,
    grossMarginRatio: 0.40,
    mdrRate: 0.02,
    maxDiscountCap: 0.15,
    minMarginFloor: 0.10,
    minClassifierConfidence: 0.85,
    ...overrides,
  });

  it('8.A For BANK_DECLINE, verify no discount is eligible', () => {
    const ctx = getBaseCtx({ failureReason: 'BANK_DECLINE' });
    const result = runInterventionTournament(ctx);
    
    const discountCandidate = result.candidates.find(c => c.action === 'TARGETED_DYNAMIC_DISCOUNT')!;
    expect(discountCandidate.eligible).toBe(false);
    expect(discountCandidate.rejectionReason).toMatch(/Ineligible: technical failure/);

    expect(['PAYMENT_RECOVERY_LINK', 'DO_NOTHING']).toContain(result.winner.action);
  });

  it('8.B For grossMarginRatio=0.05, minMarginFloor=0.10, verify winner is DO_NOTHING', () => {
    const ctx = getBaseCtx({ grossMarginRatio: 0.05 });
    const result = runInterventionTournament(ctx);

    expect(result.winner.action).toBe('DO_NOTHING');
    expect(result.winner.rejectionReason).toMatch(/below floor/);
  });

  it('8.C Verify ENI equals P_rec*(grossProfit−discount−mdrCost)−msgCost', () => {
    const ctx = getBaseCtx();
    const result = runInterventionTournament(ctx);
    
    // discount ENI:
    // grossProfit = 1000 * 0.40 = 400
    // mdrCost = 1000 * 0.02 = 20
    // discount = min(1000 * 0.15, 400 * 0.40) = min(150, 160) = 150
    // P_rec for discount = 0.70
    // ENI = 0.70 * (400 - 150 - 20) - 2.0 = 0.70 * 230 - 2 = 161 - 2 = 159
    const discountCandidate = result.candidates.find(c => c.action === 'TARGETED_DYNAMIC_DISCOUNT')!;
    expect(discountCandidate.eni).toBeCloseTo(159);
  });

  it('8.E PRICE_FRICTION allows discount', () => {
    const ctx = getBaseCtx();
    const result = runInterventionTournament(ctx);
    const discountCandidate = result.candidates.find(c => c.action === 'TARGETED_DYNAMIC_DISCOUNT')!;
    expect(discountCandidate.eligible).toBe(true);
  });

  it('8.F BANK_DECLINE cannot discount', () => {
    const ctx = getBaseCtx({ failureReason: 'BANK_DECLINE' });
    const result = runInterventionTournament(ctx);
    const discountCandidate = result.candidates.find(c => c.action === 'TARGETED_DYNAMIC_DISCOUNT')!;
    expect(discountCandidate.eligible).toBe(false);
  });

  it('8.G Discount cap enforced', () => {
    const ctx = getBaseCtx({ maxDiscountCap: 0.05 }); // very strict
    const result = runInterventionTournament(ctx);
    const discountCandidate = result.candidates.find(c => c.action === 'TARGETED_DYNAMIC_DISCOUNT')!;
    
    // discount = min(1000 * 0.05, 400 * 0.4) = min(50, 160) = 50
    expect(discountCandidate.discount).toBe(50);
  });

  it('8.H Margin floor enforced after discount', () => {
    const ctx = getBaseCtx({ grossMarginRatio: 0.20, maxDiscountCap: 0.15, minMarginFloor: 0.10 });
    // gross profit = 200
    // discount = min(150, 80) = 80
    // post discount margin = (200 - 80) / 1000 = 120 / 1000 = 0.12 > 0.10, should be eligible
    const r1 = runInterventionTournament(ctx);
    expect(r1.candidates.find(c => c.action === 'TARGETED_DYNAMIC_DISCOUNT')!.eligible).toBe(true);

    const ctx2 = getBaseCtx({ grossMarginRatio: 0.15, maxDiscountCap: 0.15, minMarginFloor: 0.10 });
    // gross profit = 150
    // discount = min(150, 60) = 60
    // post discount margin = (150 - 60) / 1000 = 90 / 1000 = 0.09 < 0.10, should be ineligible
    const r2 = runInterventionTournament(ctx2);
    expect(r2.candidates.find(c => c.action === 'TARGETED_DYNAMIC_DISCOUNT')!.eligible).toBe(false);
    expect(r2.candidates.find(c => c.action === 'TARGETED_DYNAMIC_DISCOUNT')!.rejectionReason).toMatch(/post-discount margin.*breach floor/);
  });

  it('8.I DO_NOTHING always available', () => {
    const ctx = getBaseCtx();
    const result = runInterventionTournament(ctx);
    const doNothing = result.candidates.find(c => c.action === 'DO_NOTHING')!;
    expect(doNothing.eligible).toBe(true);
    expect(doNothing.eni).toBe(0);
  });

  it('8.J Highest ENI wins', () => {
    const ctx = getBaseCtx();
    const result = runInterventionTournament(ctx);
    // 159 for discount, 206.4 for link (0.55 * 380 - 1.5). Wait, link P_rec for PRICE_FRICTION = 0.35
    // link ENI = 0.35 * 380 - 1.5 = 133 - 1.5 = 131.5
    // so discount wins
    expect(result.winner.action).toBe('TARGETED_DYNAMIC_DISCOUNT');
  });

  it('8.K Negative ENI -> DO_NOTHING', () => {
    const ctx = getBaseCtx({ mdrRate: 0.50 }); // massive mdr -> mdrCost=500 > grossProfit=400
    const result = runInterventionTournament(ctx);
    expect(result.winner.action).toBe('DO_NOTHING');
  });

  it('8.M Classifier confidence below threshold -> no discount', () => {
    const ctx = getBaseCtx({ classifierConfidence: 0.80, minClassifierConfidence: 0.85 });
    const result = runInterventionTournament(ctx);
    const discountCandidate = result.candidates.find(c => c.action === 'TARGETED_DYNAMIC_DISCOUNT')!;
    expect(discountCandidate.eligible).toBe(false);
    expect(discountCandidate.rejectionReason).toMatch(/classifier confidence/);
  });
});
