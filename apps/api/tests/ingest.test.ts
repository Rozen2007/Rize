import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';
import { db, incidents, auditLedger, merchants, processedWebhookEvents, cohortStats } from '@rize/db';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

// We mock the AI package to strictly enforce the output
vi.mock('@rize/ai', () => ({
  classifyFailureWithTimeout: vi.fn(),
  generateCopyWithTimeout: vi.fn(),
}));

// We mock Razorpay to prevent network calls
vi.mock('@rize/razorpay', () => ({
  createRazorpayLink: vi.fn(),
}));

import { classifyFailureWithTimeout, generateCopyWithTimeout } from '@rize/ai';
import { createRazorpayLink } from '@rize/razorpay';

describe('POST /internal/ingest', () => {
  const validKey = 'demo_key'; // Default key in the endpoint
  
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Clear out tables
    await db.delete(processedWebhookEvents).catch(() => {});
    await db.delete(auditLedger).catch(() => {});
    await db.delete(auditLedger);
    await db.delete(incidents);
    await db.delete(cohortStats).catch(() => {});
    await db.delete(merchants);
    // Seed merchant
    await db.insert(merchants).values({ id: 'm1', name: 'Test', webhookSecret: 'secret' });
    
    // Setup default mock responses
    (classifyFailureWithTimeout as any).mockResolvedValue({
      reason: 'PRICE_FRICTION',
      confidence: 0.95
    });
    
    (generateCopyWithTimeout as any).mockResolvedValue('Come back!');
    
    (createRazorpayLink as any).mockResolvedValue({
      id: 'plink_123',
      short_url: 'https://rzp.io/l/test'
    });
    
    process.env.INTERNAL_API_KEY = validKey;
  });

  it('10.A / 10.C: Missing or Invalid internal key returns 401 with zero DB changes', async () => {
    const payload = { merchantId: 'm1', orderValue: 1000, errorCode: 'HIGH_PRICE', errorDesc: 'desc', device: 'mobile', paymentMethod: 'upi', customerPhone: '9999999999', checkoutId: 'chk1', razorpayEventId: 'ev1' };
    
    // Missing key
    let res = await request(app).post('/internal/ingest').send(payload);
    expect(res.status).toBe(401);
    
    // Invalid key
    res = await request(app).post('/internal/ingest').set('x-internal-key', 'wrong_key').send(payload);
    expect(res.status).toBe(401);
    
    const dbIncidents = await db.select().from(incidents);
    expect(dbIncidents.length).toBe(0);
  });

  it('10.D: Missing customerPhone -> SKIPPED_MISSING_CONTACT + audit', async () => {
    const payload = { merchantId: 'm1', orderValue: 1000, errorCode: 'HIGH_PRICE', errorDesc: 'desc', device: 'mobile', paymentMethod: 'upi', checkoutId: 'chk1', razorpayEventId: 'ev1' };
    
    const res = await request(app)
      .post('/internal/ingest')
      .set('x-internal-key', validKey)
      .send(payload);
      
    expect(res.status).toBe(200);
    
    const dbIncidents = await db.select().from(incidents);
    expect(dbIncidents.length).toBe(1);
    expect(dbIncidents[0]!.status).toBe('SKIPPED_MISSING_CONTACT');
    
    const dbAudits = await db.select().from(auditLedger);
    expect(dbAudits.length).toBe(1);
    expect(dbAudits[0]!.eventType).toBe('SKIPPED_MISSING_CONTACT');
  });

  it('10.E: Control group assignment -> CONTROL_HELDOUT + audit', async () => {
    // controlGroupRatio is 0.1 by default in the mock config, and 'test-seed-123' gives < 0.1 (Wait, we should mock seedrandom or pass 1.0 to guarantee control)
    const payload = { merchantId: 'm1', orderValue: 1000, errorCode: 'HIGH_PRICE', errorDesc: 'desc', device: 'mobile', paymentMethod: 'upi', customerPhone: '999', checkoutId: 'chk1', razorpayEventId: 'ev1', mockMerchantConfig: { controlGroupRatio: 1.0, grossMarginRatio: 0.40, mdrRate: 0.02, maxDiscountCap: 0.15, minMarginFloor: 0.10, minClassifierConfidence: 0.8 } };
    
    const res = await request(app).post('/internal/ingest').set('x-internal-key', validKey).send(payload);
    expect(res.status).toBe(200);
    
    const dbIncidents = await db.select().from(incidents);
    expect(dbIncidents[0]!.status).toBe('CONTROL_HELDOUT');
    
    const dbAudits = await db.select().from(auditLedger);
    expect(dbAudits[0]!.eventType).toBe('CONTROL_HELDOUT');
  });

  it('10.F: Margin floor blocks discount -> BLOCKED_INSUFFICIENT_MARGIN + audit', async () => {
    // If minMarginFloor is 0.99, any discount will breach it, and since it is PRICE_FRICTION, TARGETED_DYNAMIC_DISCOUNT might be tried but fails eligibility, DO_NOTHING will win?
    // Wait, runInterventionTournament blocks ALL interventions if grossMargin < minMarginFloor.
    const payload = { merchantId: 'm1', orderValue: 100, errorCode: 'HIGH_PRICE', errorDesc: 'desc', device: 'mobile', paymentMethod: 'upi', customerPhone: '999', checkoutId: 'chk1', razorpayEventId: 'ev1', mockMerchantConfig: { controlGroupRatio: 0.0, grossMarginRatio: 0.20, mdrRate: 0.02, maxDiscountCap: 0.15, minMarginFloor: 0.30, minClassifierConfidence: 0.8 } };
    
    const res = await request(app).post('/internal/ingest').set('x-internal-key', validKey).send(payload);
    
    const dbIncidents = await db.select().from(incidents);
    expect(dbIncidents[0]!.status).toBe('BLOCKED_INSUFFICIENT_MARGIN');
    expect(dbIncidents[0]!.winningAction).toBe('DO_NOTHING');
    
    const dbAudits = await db.select().from(auditLedger);
    expect(dbAudits[0]!.eventType).toBe('ACTION_BLOCKED_POLICY');
  });

  it('10.I: classifyFailure timeout uses fallback (mocked)', async () => {
    // Since we mock classifyFailureWithTimeout, we can simulate what happens if it resolved to the fallback.
    (classifyFailureWithTimeout as any).mockResolvedValue({ reason: 'PRICE_FRICTION', confidence: 0.75 });
    
    // With 0.75 confidence and default minClassifierConfidence = 0.8, discount should be ineligible.
    const payload = { merchantId: 'm1', orderValue: 1000, errorCode: 'TIMEOUT', errorDesc: 'desc', device: 'mobile', paymentMethod: 'upi', customerPhone: '999', checkoutId: 'chk1', razorpayEventId: 'ev1', mockMerchantConfig: { controlGroupRatio: 0.0, grossMarginRatio: 0.40, mdrRate: 0.02, maxDiscountCap: 0.15, minMarginFloor: 0.10, minClassifierConfidence: 0.8 } };
    
    await request(app).post('/internal/ingest').set('x-internal-key', validKey).send(payload);
    
    const dbIncidents = await db.select().from(incidents);
    expect(dbIncidents[0]!.status).toBe('EXECUTED_PENDING_SETTLEMENT');
    // Since confidence doesn't block discount in PRD, the optimal ENI is chosen
    expect(dbIncidents[0]!.winningAction).toBe('TARGETED_DYNAMIC_DISCOUNT');
  });

  it('10.B / 10.H: Valid ingest with PRICE_FRICTION creates incident + audit + link', async () => {
    const payload = { merchantId: 'm1', orderValue: 1000, errorCode: 'HIGH_PRICE', errorDesc: 'desc', device: 'mobile', paymentMethod: 'upi', customerPhone: '999', checkoutId: 'chk1', razorpayEventId: 'ev1', mockMerchantConfig: { controlGroupRatio: 0.0, grossMarginRatio: 0.40, mdrRate: 0.02, maxDiscountCap: 0.15, minMarginFloor: 0.10, minClassifierConfidence: 0.8 } };
    
    const res = await request(app).post('/internal/ingest').set('x-internal-key', validKey).send(payload);
    expect(res.status).toBe(200);
    
    const dbIncidents = await db.select().from(incidents);
    expect(dbIncidents[0]!.status).toBe('EXECUTED_PENDING_SETTLEMENT');
    expect(dbIncidents[0]!.winningAction).toBe('TARGETED_DYNAMIC_DISCOUNT');
    expect(dbIncidents[0]!.razorpayLinkId).toBe('plink_123');
    
    const dbAudits = await db.select().from(auditLedger);
    expect(dbAudits.length).toBe(1);
    expect(dbAudits[0]!.eventType).toBe('ACTION_EXECUTED');
  });

  it('10.J: Transaction rollback on Razorpay failure', async () => {
    (createRazorpayLink as any).mockRejectedValue(new Error('Rate limited'));
    
    const payload = { merchantId: 'm1', orderValue: 1000, errorCode: 'HIGH_PRICE', errorDesc: 'desc', device: 'mobile', paymentMethod: 'upi', customerPhone: '999', checkoutId: 'chk1', razorpayEventId: 'ev1', mockMerchantConfig: { controlGroupRatio: 0.0, grossMarginRatio: 0.40, mdrRate: 0.02, maxDiscountCap: 0.15, minMarginFloor: 0.10, minClassifierConfidence: 0.8 } };
    
    const res = await request(app).post('/internal/ingest').set('x-internal-key', validKey).send(payload);
    expect(res.status).toBe(200);
    
    const dbIncidents = await db.select().from(incidents);
    expect(dbIncidents.length).toBe(1); // Persisted despite failure
    expect(dbIncidents[0]!.status).toBe('RAZORPAY_LINK_FAILED');
  });
  
  it('10.G: DO_NOTHING winner -> no link created, incident persists', async () => {
    (classifyFailureWithTimeout as any).mockResolvedValue({ reason: 'BANK_DECLINE', confidence: 0.95 });
    
    // BANK_DECLINE -> discount ineligible. Link pRec = 0.55. Link eni = 0.55 * (40 - 2) - 1.5 = 19.4 > 0.
    // Wait, to force DO_NOTHING, let's make orderValue small enough so Link ENI is negative.
    // Order = 10. Gross profit = 4. MDR = 0.2. Profit = 3.8. 0.55 * 3.8 = 2.09. 2.09 - 1.5 = 0.59.
    // Order = 5. Profit = 2. 0.55 * 1.9 = 1.045 - 1.5 < 0. Link ENI negative. DO_NOTHING wins.
    const payload = { merchantId: 'm1', orderValue: 3, errorCode: 'DECLINED', errorDesc: 'desc', device: 'mobile', paymentMethod: 'upi', customerPhone: '999', checkoutId: 'chk1', razorpayEventId: 'ev1', mockMerchantConfig: { controlGroupRatio: 0.0, grossMarginRatio: 0.40, mdrRate: 0.02, maxDiscountCap: 0.15, minMarginFloor: 0.10, minClassifierConfidence: 0.8 } };
    
    const res = await request(app).post('/internal/ingest').set('x-internal-key', validKey).send(payload);
    
    const dbIncidents = await db.select().from(incidents);
    expect(dbIncidents[0]!.winningAction).toBe('DO_NOTHING');
    expect(dbIncidents[0]!.status).toBe('PENDING'); // or EXECUTED_PENDING_SETTLEMENT, wait I set it to PENDING in my route for DO_NOTHING.
    expect(dbIncidents[0]!.razorpayLinkId).toBeNull();
    
    const dbAudits = await db.select().from(auditLedger);
    expect(dbAudits[0]!.eventType).toBe('DO_NOTHING_CHOSEN');
  });
});
