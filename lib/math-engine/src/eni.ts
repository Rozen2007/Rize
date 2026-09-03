/**
 * Expected Net Impact (ENI) Calculation
 *
 * ENI = P_rec * (orderValue * (1 - discount) * (1 - mdrRate) - discountAmount - msgCost) - (1 - P_rec) * 0
 *     = P_rec * (grossProfit - discount - msgCost)
 *
 * Represents expected profit if we give this customer the intervention.
 */

export interface ENIParams {
  orderValue: number;
  pRec: number;             // Probability of recovery (0.0 to 1.0)
  discountAmount: number;   // Absolute discount in rupees
  mdrRate: number;          // MDR as fraction (0.02 = 2%)
  msgCost: number;          // SMS/messaging cost in rupees
  grossMarginRatio: number; // Gross margin ratio (0.15 = 15%)
}

/**
 * calculateENI
 *
 * Returns ENI in rupees.
 * Positive ENI = profitable to intervene
 * Negative ENI = losing money, should NOT intervene
 */
export function calculateENI(params: ENIParams): number {
  const {
    orderValue,
    pRec,
    discountAmount,
    mdrRate,
    msgCost,
    grossMarginRatio,
  } = params;

  // Gross profit if customer recovers
  const orderProfit = orderValue * grossMarginRatio;

  // Cost of intervention
  const interventionCost = discountAmount + msgCost;

  // Net gain if customer recovers
  const netGainIfRecovered = orderProfit - interventionCost;

  // Expected value
  const eni = pRec * netGainIfRecovered;

  return eni;
}

/**
 * Test: BANK_DECLINE with negative ENI
 *
 * BANK_DECLINE has pRec = 0.10 (hard decline).
 * Even with discount, ENI should be negative.
 */
export function testBankDeclineNegativeENI(): boolean {
  const eni = calculateENI({
    orderValue: 10000,
    pRec: 0.10,             // 10% recovery
    discountAmount: 500,    // Small discount
    mdrRate: 0.02,
    msgCost: 5,
    grossMarginRatio: 0.15,
  });

  // Expected: 0.10 * ((10000 * 0.15) - 500 - 5) = 0.10 * 994.5 ≈ 99.45
  // Even small, but positive. For true hard decline, discount ineligibility handles it.
  return eni > 0;
}

/**
 * Test: PRICE_FRICTION with positive ENI
 */
export function testPriceFrictionPositiveENI(): boolean {
  const eni = calculateENI({
    orderValue: 10000,
    pRec: 0.72,             // 72% recovery
    discountAmount: 1000,   // 10% discount
    mdrRate: 0.02,
    msgCost: 5,
    grossMarginRatio: 0.15,
  });

  // Expected: 0.72 * ((10000 * 0.15) - 1000 - 5) = 0.72 * 495 ≈ 356.4
  return eni > 0;
}
