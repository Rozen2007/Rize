import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') }); // It's in apps/api/scripts/seed.ts, so 4 levels up

import { db, merchants, incidents, cohortStats } from '@rize/db';

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

  console.log('Generating 60 incidents...');
  
  // Clean up old synthetic data
  await db.delete(cohortStats).where(undefined as any).catch(() => {}); // clean all
  await db.delete(incidents).where(undefined as any).catch(() => {});
  
  const incidentData: any[] = [];
  let idCounter = 1;

  // PRICE_FRICTION: 24 incidents, 72% success (17 recovered)
  for (let i = 0; i < 24; i++) {
    const isControl = i % 10 === 0;
    let status;
    if (isControl) {
      status = i % 3 === 0 ? 'RECOVERED' : 'CONTROL_HELDOUT';
    } else {
      status = i % 3 !== 0 ? 'RECOVERED' : 'EXPIRED'; // ~66% recovery for treatment
    }
    
    incidentData.push({
      id: `inc_pf_${idCounter++}`,
      merchantId: 'test',
      razorpayEventId: `event_pf_${idCounter}`,
      checkoutId: `checkout_pf_${idCounter}`,
      failureReason: 'PRICE_FRICTION',
      device: i < 14 ? 'mobile' : 'desktop',
      paymentMethod: i % 2 === 0 ? 'card' : 'upi',
      affectedCohort: `${i < 14 ? 'mobile' : 'desktop'}:PRICE_FRICTION:${i % 2 === 0 ? 'card' : 'upi'}`,
      orderValue: Math.floor(Math.random() * 5000) + 500,
      isControl,
      winningAction: 'TARGETED_DYNAMIC_DISCOUNT',
      winningENI: 50.0,
      winningPRec: 0.72,
      candidatesJson: '{}',
      status,
    });
  }

  // AUTH_TIMEOUT: 18 incidents, 45% success (8 recovered)
  for (let i = 0; i < 18; i++) {
    const isControl = i % 10 === 0;
    incidentData.push({
      id: `inc_at_${idCounter++}`,
      merchantId: 'test',
      razorpayEventId: `event_at_${idCounter}`,
      checkoutId: `checkout_at_${idCounter}`,
      failureReason: 'AUTH_TIMEOUT',
      device: i % 2 === 0 ? 'mobile' : 'desktop',
      paymentMethod: i % 2 === 0 ? 'card' : 'upi',
      affectedCohort: `${i % 2 === 0 ? 'mobile' : 'desktop'}:AUTH_TIMEOUT:${i % 2 === 0 ? 'card' : 'upi'}`,
      orderValue: Math.floor(Math.random() * 5000) + 500,
      isControl,
      winningAction: 'DO_NOTHING',
      winningENI: 0.0,
      winningPRec: 0.45,
      candidatesJson: '{}',
      status: i % 3 === 0 ? 'RECOVERED' : (isControl ? 'CONTROL_HELDOUT' : 'EXPIRED'),
    });
  }

  // EXPIRED_CARD: 12 incidents, 38% success (4 recovered - wait, 12 * 0.38 is ~4.5)
  for (let i = 0; i < 12; i++) {
    const isControl = i % 10 === 0;
    incidentData.push({
      id: `inc_ec_${idCounter++}`,
      merchantId: 'test',
      razorpayEventId: `event_ec_${idCounter}`,
      checkoutId: `checkout_ec_${idCounter}`,
      failureReason: 'EXPIRED_CARD',
      device: 'mobile', // simplfied
      paymentMethod: i < 8 ? 'card' : 'upi', // 70% card
      affectedCohort: `mobile:EXPIRED_CARD:${i < 8 ? 'card' : 'upi'}`,
      orderValue: Math.floor(Math.random() * 5000) + 500,
      isControl,
      winningAction: 'DO_NOTHING',
      winningENI: 0.0,
      winningPRec: 0.38,
      candidatesJson: '{}',
      status: i % 4 === 0 ? 'RECOVERED' : (isControl ? 'CONTROL_HELDOUT' : 'EXPIRED'),
    });
  }

  // BANK_DECLINE: 6 incidents, 10% success (1 recovered)
  for (let i = 0; i < 6; i++) {
    const isControl = i % 10 === 0;
    incidentData.push({
      id: `inc_bd_${idCounter++}`,
      merchantId: 'test',
      razorpayEventId: `event_bd_${idCounter}`,
      checkoutId: `checkout_bd_${idCounter}`,
      failureReason: 'BANK_DECLINE',
      device: 'desktop', // simplified
      paymentMethod: i < 5 ? 'card' : 'upi', // 80% card
      affectedCohort: `desktop:BANK_DECLINE:${i < 5 ? 'card' : 'upi'}`,
      orderValue: Math.floor(Math.random() * 5000) + 500,
      isControl,
      winningAction: 'DO_NOTHING',
      winningENI: 0.0,
      winningPRec: 0.10,
      candidatesJson: '{}',
      status: i % 5 === 0 ? 'RECOVERED' : (isControl ? 'CONTROL_HELDOUT' : 'EXPIRED'),
    });
  }

  await db.insert(incidents).values(incidentData).onConflictDoNothing();

  // Aggregate cohort stats
  console.log('Aggregating cohort stats...');
  const cohortStatsData = computeCohortStats(incidentData);
  
  if (cohortStatsData.length > 0) {
    await db.insert(cohortStats).values(cohortStatsData as any[]).onConflictDoNothing();
  }

  console.log(`✅ Seeded ${incidentData.length} incidents and ${cohortStatsData.length} cohort stats`);
  process.exit(0);
}

function computeCohortStats(incidentsList: any[]) {
  const map = new Map();
  
  for (const inc of incidentsList) {
    const key = `${inc.device}:${inc.failureReason}:${inc.paymentMethod}`;
    
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
  return Array.from(map.entries()).map(([cohortKey, stats]) => {
    const reason = cohortKey.split(':')[1];
    return {
      id: `cs_${statId++}`,
      cohortKey,
      merchantId: 'test',
      actionType: reason === 'PRICE_FRICTION' ? 'TARGETED_DYNAMIC_DISCOUNT' : 'DO_NOTHING',
      totalAttempts: stats.totalAttempts,
      totalSuccesses: stats.totalSuccesses,
    };
  });
}

seed().catch(console.error);
