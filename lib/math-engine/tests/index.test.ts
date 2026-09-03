import { describe, it, expect } from 'vitest';
import {
  calculateEmpiricalPRec,
  testColdStart,
  testBayesianUpdate,
} from '../src/bayesian.js';
import {
  calculateENI,
  testBankDeclineNegativeENI,
  testPriceFrictionPositiveENI,
} from '../src/eni.js';
import {
  runInterventionTournament,
  type ContextInput,
} from '../src/tournament.js';

describe('Math Engine', () => {
  describe('Bayesian P_rec', () => {
    it('8.A: Cold-start returns prior', () => {
      expect(testColdStart()).toBe(true);
    });

    it('8.B: Bayesian update with data', () => {
      expect(testBayesianUpdate()).toBe(true);
    });
  });

  describe('ENI Calculation', () => {
    it('8.C: ENI formula correct', () => {
      const eni = calculateENI({
        orderValue: 10000,
        pRec: 0.72,
        discountAmount: 1000,
        mdrRate: 0.02,
        msgCost: 5,
        grossMarginRatio: 0.15,
      });

      // Expected: 0.72 * ((10000 * 0.15) - 1000 - 5)
      // = 0.72 * 495 = 356.4
      expect(eni).toBeCloseTo(356.4, 1);
    });
  });

  describe('Tournament', () => {
    it('BANK_DECLINE blocks discount', () => {
      const result = runInterventionTournament({
        failureReason: 'BANK_DECLINE',
        classifierConfidence: 0.95,
        orderValue: 10000,
        device: 'mobile',
        paymentMethod: 'card',
        grossMarginRatio: 0.15,
        mdrRate: 0.02,
        msgCost: 5,
        minClassifierConfidence: 0.80,
        minMarginFloor: 0.10,
        maxDiscountCap: 1000,
        maxDiscountPercentage: 0.15,
      });

      expect(result.winner.type).not.toBe('TARGETED_DYNAMIC_DISCOUNT');
    });

    it('PRICE_FRICTION allows discount if confident', () => {
      const result = runInterventionTournament({
        failureReason: 'PRICE_FRICTION',
        classifierConfidence: 0.95,
        orderValue: 10000,
        device: 'mobile',
        paymentMethod: 'card',
        grossMarginRatio: 0.30,
        mdrRate: 0.02,
        msgCost: 5,
        minClassifierConfidence: 0.80,
        minMarginFloor: 0.10,
        maxDiscountCap: 1000,
        maxDiscountPercentage: 0.15,
      });

      expect(result.winner.type).toBe('TARGETED_DYNAMIC_DISCOUNT');
    });



    it('Margin floor blocks discount', () => {
      const result = runInterventionTournament({
        failureReason: 'PRICE_FRICTION',
        orderValue: 1000,
        grossMarginRatio: 0.05, // Below floor
        mdrRate: 0.02,
        minMarginFloor: 0.10,
        maxDiscountCap: 0.15,
      } as any);

      expect(result.winner.type).toBe('DO_NOTHING');
    });
  });
});
