import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') }); // It's in apps/api/scripts/seed.ts, so 4 levels up

import { db, merchants, incidents, cohortStats } from '@rize/db';

// Deterministic RNG (Mulberry32)
function mulberry32(a: number) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}
const random = mulberry32(1234567);

async function seed() {
  console.log('Seeding merchant...');
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_secret_123';
  
  await db.insert(merchants).values({
    id: 'test',
    name: 'Test Merchant',
    webhookSecret,
    grossMarginRatio: 0.40,
    mdrRate: 0.02,
    maxDiscountCap: 0.15,
    minMarginFloor: 0.10,
    controlGroupRatio: 0.10,
  }).onConflictDoNothing();

  console.log('Cleaning up old synthetic data...');
  await db.delete(cohortStats).catch(() => {});
  await db.delete(incidents).catch(() => {});
  
  const incidentData: any[] = [];
  let idCounter = 1;

  // Base recovery probabilities based on action and failure reason
  const getSimulatedOutcome = (failureReason: string, actionType: string, isControl: boolean) => {
    if (isControl || actionType === 'DO_NOTHING') return random() < 0.05 ? 'RECOVERED' : 'EXPIRED'; // 5% baseline

    if (failureReason === 'PRICE_FRICTION') {
      if (actionType === 'TARGETED_DYNAMIC_DISCOUNT') return random() < 0.72 ? 'RECOVERED' : 'EXPIRED';
      if (actionType === 'PAYMENT_RECOVERY_LINK') return random() < 0.35 ? 'RECOVERED' : 'EXPIRED';
    } else if (failureReason === 'AUTH_TIMEOUT') {
      if (actionType === 'PAYMENT_RECOVERY_LINK') return random() < 0.45 ? 'RECOVERED' : 'EXPIRED';
    } else if (failureReason === 'EXPIRED_CARD') {
      if (actionType === 'PAYMENT_RECOVERY_LINK') return random() < 0.38 ? 'RECOVERED' : 'EXPIRED';
    } else if (failureReason === 'BANK_DECLINE') {
      if (actionType === 'PAYMENT_RECOVERY_LINK') return random() < 0.10 ? 'RECOVERED' : 'EXPIRED';
    }
    return 'EXPIRED';
  };

  const generateIncidents = (count: number, isHistorical: boolean) => {
    const batchId = isHistorical ? null : 'demo_batch_1';
    
    // Distribution roughly matches original: 40% PF, 30% AT, 20% EC, 10% BD
    for (let i = 0; i < count; i++) {
      const isControl = random() < 0.10; // 10% control group
      
      let failureReason = 'PRICE_FRICTION';
      let device = 'mobile';
      let paymentMethod = 'upi';
      
      const r = random();
      if (r > 0.9) { failureReason = 'BANK_DECLINE'; device = 'desktop'; paymentMethod = 'card'; }
      else if (r > 0.7) { failureReason = 'EXPIRED_CARD'; device = 'mobile'; paymentMethod = 'card'; }
      else if (r > 0.4) { failureReason = 'AUTH_TIMEOUT'; device = 'desktop'; paymentMethod = 'upi'; }
      else if (r > 0.2) { device = 'desktop'; paymentMethod = 'card'; }

      const cohortKey = `${device}:${failureReason}:${paymentMethod}`;
      const orderVal = Math.floor(random() * 5000) + 500;
      
      let winningAction = 'DO_NOTHING';
      let discountOffered = 0;

      // Unbiased random assignment of actions (Uniform over eligible)
      if (!isControl) {
        if (failureReason === 'PRICE_FRICTION') {
          const acts = ['TARGETED_DYNAMIC_DISCOUNT', 'PAYMENT_RECOVERY_LINK', 'DO_NOTHING'];
          winningAction = acts[Math.floor(random() * acts.length)]!;
        } else {
          const acts = ['PAYMENT_RECOVERY_LINK', 'DO_NOTHING'];
          winningAction = acts[Math.floor(random() * acts.length)]!;
        }
      }

      if (winningAction === 'TARGETED_DYNAMIC_DISCOUNT') {
        discountOffered = (Math.floor(random() * 10) + 5) / 100; // 5% to 14%
      }

      const status = getSimulatedOutcome(failureReason, winningAction, isControl);
      const eniScore = winningAction === 'DO_NOTHING' ? 0.0 : (orderVal * 0.4 * (1 - discountOffered));

      incidentData.push({
        id: `inc_${idCounter++}`,
        merchantId: 'test',
        razorpayEventId: `event_seed_${idCounter}`,
        batchId,
        checkoutId: `checkout_seed_${idCounter}`,
        failureReason,
        device,
        paymentMethod,
        affectedCohort: cohortKey,
        orderValue: orderVal,
        isControl,
        winningAction,
        winningENI: eniScore,
        winningPRec: random() * 0.5 + 0.3, // Mock PRec
        discountOffered,
        candidatesJson: '[]',
        status: isControl ? (status === 'RECOVERED' ? 'RECOVERED' : 'CONTROL_HELDOUT') : status,
      });
    }
  };

  console.log('Generating ~120 historical incidents (for Bayesian priors)...');
  generateIncidents(120, true);

  console.log('Generating 60 live demo incidents...');
  generateIncidents(60, false);

  await db.insert(incidents).values(incidentData).onConflictDoNothing();

  // Aggregate cohort stats ONLY from historical incidents to prevent lookahead bias
  console.log('Aggregating historical cohort stats...');
  const historicalIncidents = incidentData.filter(inc => inc.batchId === null);
  const cohortStatsData = computeCohortStats(historicalIncidents);
  
  if (cohortStatsData.length > 0) {
    await db.insert(cohortStats).values(cohortStatsData as any[]).onConflictDoNothing();
  }

  console.log(`✅ Seeded ${incidentData.length} total incidents and ${cohortStatsData.length} cohort stats`);
  process.exit(0);
}

function computeCohortStats(incidentsList: any[]) {
  const map = new Map();
  
  for (const inc of incidentsList) {
    if (inc.isControl) continue; // Control group actions shouldn't pollute intervention stats
    
    // Group by both cohortKey AND actionType to preserve unbiased Bayesian estimates
    const key = `${inc.affectedCohort}|${inc.winningAction}`;
    
    if (!map.has(key)) {
      map.set(key, { totalAttempts: 0, totalSuccesses: 0 });
    }
    
    const stats = map.get(key);
    stats.totalAttempts += 1;
    if (inc.status === 'RECOVERED') {
      stats.totalSuccesses += 1;
    }
  }

  let statId = 1;
  return Array.from(map.entries()).map(([keyStr, stats]) => {
    const [cohortKey, actionType] = keyStr.split('|');
    return {
      id: `cs_${statId++}`,
      cohortKey,
      merchantId: 'test',
      actionType,
      totalAttempts: stats.totalAttempts,
      totalSuccesses: stats.totalSuccesses,
    };
  });
}

seed().catch(console.error);
