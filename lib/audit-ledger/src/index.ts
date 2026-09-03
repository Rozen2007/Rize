import { eq, desc, sql, asc } from 'drizzle-orm';
import { auditLedger } from '@rize/db';
import crypto from 'crypto';

export interface AuditPayload {
  incidentId: string;
  eventType: string;
  eniScore: number;
}

const GENESIS_HASH = '0'.repeat(64);
const ADVISORY_LOCK_ID = 727384991;

/**
 * Commits a new audit block inside a given Drizzle transaction.
 * Acquires a transaction-level advisory lock to serialize inserts.
 */
export async function commitAuditBlockAtomic(tx: any, payload: AuditPayload): Promise<void> {
  // 1. Acquire transaction-level lock
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_ID})`);

  // 2. Get last block to find sequenceId and previousHash
  const lastBlock = await tx.select()
    .from(auditLedger)
    .orderBy(desc(auditLedger.sequenceId))
    .limit(1)
    .then((res: any[]) => res[0] || null);

  const previousHash = lastBlock ? lastBlock.currentHash : GENESIS_HASH;
  const sequenceId = lastBlock ? lastBlock.sequenceId + 1 : 1;
  const createdAtMs = Date.now().toString();

  // 3. Compute hash deterministically
  const rawPayload = `${previousHash}|${payload.incidentId}|${payload.eventType}|${payload.eniScore.toFixed(2)}|${createdAtMs}`;
  const currentHash = crypto.createHash('sha256').update(rawPayload).digest('hex');

  // 4. Insert the block
  await tx.insert(auditLedger).values({
    sequenceId,
    incidentId: payload.incidentId,
    eventType: payload.eventType,
    eniScore: payload.eniScore,
    previousHash,
    currentHash,
    createdAtMs,
  });
}

/**
 * Verifies the integrity of the ledger.
 * Returns null if intact, or the sequenceId of the first broken block.
 */
export async function verifyLedgerIntegrity(db: any): Promise<number | null> {
  // Stream or fetch all blocks ordered by sequenceId
  const blocks = await db.select()
    .from(auditLedger)
    .orderBy(asc(auditLedger.sequenceId));

  let expectedPreviousHash = GENESIS_HASH;

  for (const block of blocks) {
    if (block.previousHash !== expectedPreviousHash) {
      return block.sequenceId;
    }

    const rawPayload = `${block.previousHash}|${block.incidentId}|${block.eventType}|${Number(block.eniScore).toFixed(2)}|${block.createdAtMs}`;
    const derivedHash = crypto.createHash('sha256').update(rawPayload).digest('hex');

    if (derivedHash !== block.currentHash) {
      return block.sequenceId;
    }

    expectedPreviousHash = block.currentHash;
  }

  return null; // intact
}
