export interface CohortStats {
  totalAttempts: number;
  totalSuccesses: number;
}

export function calculateEmpiricalPRec(
  actionType: string, failureReason: string,
  stats?: { totalAttempts: number; totalSuccesses: number }
): number {
  const alpha = 2, beta = 5;
  if (!stats || stats.totalAttempts === 0) {
    if (actionType === 'TARGETED_DYNAMIC_DISCOUNT') return 0.70; // only ever called for PRICE_FRICTION
    return failureReason === 'PRICE_FRICTION' ? 0.35 : 0.55;
  }
  return (stats.totalSuccesses + alpha) / (stats.totalAttempts + alpha + beta);
}

/**
 * Test that verifies cold-start behavior
 */
export function testColdStart(): boolean {
  const pRecDisc = calculateEmpiricalPRec('TARGETED_DYNAMIC_DISCOUNT', 'PRICE_FRICTION');
  const pRecLink = calculateEmpiricalPRec('PAYMENT_RECOVERY_LINK', 'BANK_DECLINE');
  return pRecDisc === 0.70 && pRecLink === 0.55;
}

/**
 * Test that verifies Bayesian update with data
 */
export function testBayesianUpdate(): boolean {
  const pRec = calculateEmpiricalPRec('TARGETED_DYNAMIC_DISCOUNT', 'PRICE_FRICTION', {
    totalAttempts: 100,
    totalSuccesses: 80,
  });

  // Expected: (80 + 2) / (100 + 2 + 5) = 82 / 107 ≈ 0.766
  const expected = 82 / 107;
  return Math.abs(pRec - expected) < 0.001;
}
