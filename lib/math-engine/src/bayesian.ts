/**
 * Bayesian P_rec Calculation
 *
 * Computes the posterior probability of recovery given:
 * - Prior P_rec (from policy)
 * - Cohort historical data (successes / attempts)
 * - Regularization (N = pseudo-observations)
 */

export interface CohortStats {
  totalAttempts: number;
  totalSuccesses: number;
}

export interface BayesianParams {
  priorPRec: number; // Prior belief (0.0 to 1.0)
  N: number; // Pseudo-observations (regularization)
  cohortStats?: CohortStats; // Observed data (null = no history)
}

/**
 * calculateEmpiricalPRec
 *
 * Formula (Beta-Binomial conjugate):
 * P_rec = (successes + N * priorPRec) / (attempts + N)
 *
 * This naturally handles cold-start (no cohort data) via the prior.
 * As attempts → ∞, posterior → empirical rate.
 */
export function calculateEmpiricalPRec(params: BayesianParams): number {
  const { priorPRec, N, cohortStats } = params;

  // Cold-start: no cohort history → use prior
  if (!cohortStats || cohortStats.totalAttempts === 0) {
    return priorPRec;
  }

  // Bayesian update: posterior = (successes + pseudo_successes) / (attempts + pseudo_observations)
  const pseudoSuccesses = N * priorPRec;
  const posteriorSuccesses = cohortStats.totalSuccesses + pseudoSuccesses;
  const posteriorAttempts = cohortStats.totalAttempts + N;

  const pRec = posteriorSuccesses / posteriorAttempts;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, pRec));
}

/**
 * Test that verifies cold-start behavior
 */
export function testColdStart(): boolean {
  const prior = 0.50;
  const N = 10;
  const pRec = calculateEmpiricalPRec({
    priorPRec: prior,
    N,
    cohortStats: undefined, // No data
  });

  return pRec === prior;
}

/**
 * Test that verifies Bayesian update with data
 */
export function testBayesianUpdate(): boolean {
  const prior = 0.50;
  const N = 10;
  const pRec = calculateEmpiricalPRec({
    priorPRec: prior,
    N,
    cohortStats: {
      totalAttempts: 100,
      totalSuccesses: 80, // 80% empirical
    },
  });

  // Expected: (80 + 10*0.50) / (100 + 10) = 85 / 110 ≈ 0.773
  const expected = (80 + 10 * prior) / (100 + 10);
  return Math.abs(pRec - expected) < 0.001;
}
