import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, auditLedger, incidents, merchants, actionTypeEnum, failureReasonEnum } from '@rize/db';
import { eq } from 'drizzle-orm';
import { commitAuditBlockAtomic, verifyLedgerIntegrity } from '../src/index';

const testMerchantId = 'test_merchant_ledger';
const testIncidentId = 'test_incident_ledger';

describe('Audit Ledger', () => {
  beforeAll(async () => {
    // Clean up previous runs
    await db.delete(auditLedger);
    await db.delete(incidents).where(eq(incidents.id, testIncidentId));
    await db.delete(merchants).where(eq(merchants.id, testMerchantId));

    // Seed dummy merchant and incident to satisfy foreign key constraints
    await db.insert(merchants).values({
      id: testMerchantId,
      name: 'Test Merchant',
      webhookSecret: 'secret',
      grossMarginRatio: 0.4,
      mdrRate: 0.02,
      maxDiscountCap: 0.15,
      minMarginFloor: 0.1,
      controlGroupRatio: 0.1,
    });

    await db.insert(incidents).values({
      id: testIncidentId,
      merchantId: testMerchantId,
      razorpayEventId: 'test_evt_ledger',
      checkoutId: 'chk_test',
      orderValue: 1000,
      failureReason: 'PRICE_FRICTION',
      device: 'Desktop',
      paymentMethod: 'UPI',
      affectedCohort: 'Desktop:PRICE_FRICTION:UPI',
      isControl: false,
      winningAction: 'PAYMENT_RECOVERY_LINK',
      winningENI: 100,
      winningPRec: 0.5,
      discountOffered: 0,
      candidatesJson: '[]',
      status: 'PENDING',
    });
  });

  afterAll(async () => {
    // Cleanup
    await db.delete(auditLedger);
    await db.delete(incidents).where(eq(incidents.id, testIncidentId));
    await db.delete(merchants).where(eq(merchants.id, testMerchantId));
  });

  it('9.A Fire 20 concurrent commitAuditBlockAtomic calls and verify integrity (no fork)', async () => {
    // Clear ledger before test
    await db.delete(auditLedger);

    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(
        db.transaction(async (tx) => {
          await commitAuditBlockAtomic(tx, {
            incidentId: testIncidentId,
            eventType: `CONCURRENT_TEST_${i}`,
            eniScore: 100 + i,
          });
        })
      );
    }

    await Promise.all(promises);

    const result = await verifyLedgerIntegrity(db);
    expect(result).toBeNull(); // Should be intact

    const blocks = await db.select().from(auditLedger);
    expect(blocks.length).toBe(20);
  });

  it('9.B Manually UPDATE one eniScore row in SQL; verifyLedgerIntegrity returns sequenceId', async () => {
    // We already have 20 intact blocks from the previous test
    // Let's tamper with block at sequenceId = 10 (or any middle block)
    const blocks = await db.select().from(auditLedger);
    const targetBlock = blocks[5]; // sequenceId is probably 6 if 1-indexed

    await db.update(auditLedger)
      .set({ eniScore: targetBlock.eniScore + 999 })
      .where(eq(auditLedger.sequenceId, targetBlock.sequenceId));

    const result = await verifyLedgerIntegrity(db);
    expect(result).toBe(targetBlock.sequenceId); // Should catch the exact tampered sequenceId
  });
});
