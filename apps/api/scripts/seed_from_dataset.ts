/**
 * seed_from_dataset.ts
 *
 * Loads the synthetic_payment_recovery_data.csv into Postgres.
 * All KPIs on the dashboard (incremental lift, GMV, calibration, cohort stats)
 * become derived from the dataset — nothing is hardcoded.
 *
 * Usage:
 *   pnpm --filter @rize/api tsx scripts/seed_from_dataset.ts [path/to/csv]
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { db, merchants, incidents, cohortStats } from '@rize/db';

// ── helpers ────────────────────────────────────────────────────────────────

function parseCSV(filePath: string): Record<string, string>[] {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  const lines = raw.split('\n');
  const header = lines[0].split(',');
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    // handle quoted fields containing commas
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of lines[i]) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { fields.push(current); current = ''; continue; }
      current += ch;
    }
    fields.push(current);
    const row: Record<string, string> = {};
    header.forEach((h, idx) => { row[h] = fields[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

// ── mappings ───────────────────────────────────────────────────────────────

const FAILURE_REASON_MAP: Record<string, string> = {
  customer_abandonment:    'PRICE_FRICTION',
  authentication_failure:  'AUTH_TIMEOUT',
  technical_error:         'AUTH_TIMEOUT',
  insufficient_funds:      'BANK_DECLINE',
  bank_decline:            'BANK_DECLINE',
  expired_card:            'EXPIRED_CARD',
  price_friction:          'PRICE_FRICTION',
  none:                    'PRICE_FRICTION',          // fallback (control / no-fail)
};

const WINNING_ACTION_MAP: Record<string, string> = {
  none:                   'DO_NOTHING',
  payment_retry:          'PAYMENT_RECOVERY_LINK',
  alternative_payment:    'PAYMENT_RECOVERY_LINK',
  urgency_message:        'PAYMENT_RECOVERY_LINK',
  personalized_offer:     'PAYMENT_RECOVERY_LINK',
  '2_percent_discount':   'TARGETED_DYNAMIC_DISCOUNT',
  '4_percent_discount':   'TARGETED_DYNAMIC_DISCOUNT',
  '6_percent_discount':   'TARGETED_DYNAMIC_DISCOUNT',
  '8_percent_discount':   'TARGETED_DYNAMIC_DISCOUNT',
};

// High-ENI recent records → PENDING_APPROVAL (so the queue is naturally populated)
const QUEUE_SIZE = 40;

async function seed() {
  // ── merchant config ──────────────────────────────────────────────────────
  console.log('Upserting merchant config...');
  await db.insert(merchants).values({
    id: 'test',
    name: 'Test Merchant',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || 'test_secret_123',
    grossMarginRatio: 0.40,
    mdrRate: 0.02,
    maxDiscountCap: 0.15,
    minMarginFloor: 0.10,
    controlGroupRatio: 0.12,            // matches dataset (11.7%)
    tauApprove: 5000,
  }).onConflictDoNothing();

  // ── clean up previous dataset rows ───────────────────────────────────────
  console.log('Clearing previous synthetic dataset...');
  await db.delete(cohortStats).catch(() => {});
  await db.delete(incidents).catch(() => {});

  // ── read CSV ─────────────────────────────────────────────────────────────
  const csvPath = process.argv[2]
    || path.resolve(__dirname, '../../../synthetic_payment_recovery_data.csv');

  console.log(`Reading CSV: ${csvPath}`);
  const rows = parseCSV(csvPath);
  console.log(`  → ${rows.length} rows`);

  // ── build incident records ───────────────────────────────────────────────

  // Identify the top QUEUE_SIZE most-recent high-ENI treatment rows for the approval queue
  const highEniTreatment = rows
    .filter(r => r.treatment_group === 'treatment' && parseFloat(r.expected_net_income) > 5000)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, QUEUE_SIZE);
  const queueIds = new Set(highEniTreatment.map(r => r.incident_id));

  // Cohort aggregation: cohortKey → actionType → {attempts, successes}
  const cohortAgg = new Map<string, { attempts: number; successes: number }>();

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const batch = slice.map(r => {
      const isControl = r.treatment_group === 'control';
      const recovered = r.recovered === '1';
      const winningAction = WINNING_ACTION_MAP[r.intervention_type] ?? 'DO_NOTHING';
      const failureReason = FAILURE_REASON_MAP[r.payment_failure_reason] ?? 'PRICE_FRICTION';

      let status: string;
      if (isControl) {
        status = recovered ? 'RECOVERED' : 'CONTROL_HELDOUT';
      } else if (queueIds.has(r.incident_id)) {
        // High-ENI recent treatment row → approval queue
        status = 'PENDING_APPROVAL';
      } else {
        status = recovered ? 'RECOVERED' : 'EXPIRED';
      }

      // Cohort aggregation (only non-control treatment rows)
      if (!isControl) {
        const cohortKey = `${r.device_type.toLowerCase()}:${failureReason}:${r.payment_method.toLowerCase()}`;
        const actKey = `${cohortKey}|${winningAction}`;
        if (!cohortAgg.has(actKey)) cohortAgg.set(actKey, { attempts: 0, successes: 0 });
        const s = cohortAgg.get(actKey)!;
        s.attempts++;
        if (recovered) s.successes++;
      }

      return {
        id:               r.incident_id,
        merchantId:       'test',
        razorpayEventId:  `evt_${r.incident_id}`,
        batchId:          null as string | null,
        checkoutId:       r.session_id,
        customerPhone:    null as string | null,
        orderValue:       parseFloat(r.order_value),
        failureReason,
        device:           r.device_type,
        paymentMethod:    r.payment_method,
        affectedCohort:   `${r.device_type.toLowerCase()}:${failureReason}:${r.payment_method.toLowerCase()}`,
        isControl,
        winningAction,
        winningENI:       parseFloat(r.expected_net_income),
        winningPRec:      parseFloat(r.predicted_probability),
        discountOffered:  parseFloat(r.discount_amount) || 0,
        candidatesJson:   JSON.stringify([          // minimal reconstruct for explain route
          { action: 'DO_NOTHING', pRec: parseFloat(r.baseline_conversion_probability), eni: 0 },
          { action: winningAction, pRec: parseFloat(r.predicted_probability), eni: parseFloat(r.expected_net_income) },
        ]),
        rejectionReason:  null as string | null,
        smsCopy:          null as string | null,
        razorpayLinkId:   null as string | null,
        razorpayLinkUrl:  null as string | null,
        razorpayPaymentId:null as string | null,
        status,
        createdAt:        new Date(r.timestamp),
        updatedAt:        new Date(r.timestamp),
      };
    });

    await db.insert(incidents).values(batch as any[]).onConflictDoNothing();
    process.stdout.write(`  Inserted ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
  }
  console.log();

  // ── cohort stats ─────────────────────────────────────────────────────────

  let statId = 1;
  const cohortStatsRows = Array.from(cohortAgg.entries()).map(([key, { attempts, successes }]) => {
    const [cohortKey, actionType] = key.split('|');
    return {
      id:            `cs_${statId++}`,
      merchantId:    'test',
      cohortKey,
      actionType,
      totalAttempts: attempts,
      totalSuccesses: successes,
      updatedAt:     new Date(),
    };
  });

  console.log(`Inserting ${cohortStatsRows.length} cohort_stat rows...`);
  // Cohort stats are small (< 200 rows) — single insert is fine
  if (cohortStatsRows.length > 0) {
    await db.insert(cohortStats).values(cohortStatsRows as any[]).onConflictDoNothing();
  }

  // ── summary ──────────────────────────────────────────────────────────────
  const totalTreatment = rows.filter(r => r.treatment_group === 'treatment').length;
  const totalRecovered = rows.filter(r => r.recovered === '1').length;

  console.log(`
✅ Dataset seeded into Postgres
   ${rows.length} incidents  (${(rows.filter(r => r.treatment_group === 'control').length)} control, ${totalTreatment} treatment)
   ${cohortStatsRows.length} cohort_stats rows
   ${queueIds.size} records in PENDING_APPROVAL queue (high-ENI, recent)
   Overall recovery rate: ${(totalRecovered / rows.length * 100).toFixed(1)}%
   Dashboard will now show data derived entirely from the synthetic dataset.
`);
  process.exit(0);
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
