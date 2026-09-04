import { db, incidents, merchants } from './lib/db/src/index.js';
import crypto from 'crypto';

async function seed() {
  console.log('Seeding merchant and 20 incidents for calibration...');
  
  // First ensure the merchant exists to satisfy foreign key constraint
  await db.insert(merchants).values({
    id: 'test',
    name: 'Test Merchant',
    webhookSecret: 'secret',
    grossMarginRatio: 0.40,
    mdrRate: 0.02,
    maxDiscountCap: 0.15,
    minMarginFloor: 0.10,
    controlGroupRatio: 0.10,
    tauApprove: 5000,
  }).onConflictDoNothing();

  const newIncidents: any[] = [];
  
  // Create 20 mock incidents with randomized predictions to generate a curve
  for (let i = 0; i < 20; i++) {
    // distribute pRec between 0.1 and 0.9
    const pRec = 0.1 + (i / 20) * 0.8;
    // chance of recovery roughly correlates with pRec
    const recovered = Math.random() < pRec;
    
    newIncidents.push({
      id: crypto.randomUUID(),
      merchantId: 'test',
      orderValue: 5000 + (Math.random() * 50000),
      failureReason: 'PRICE_FRICTION',
      device: 'desktop',
      paymentMethod: 'card',
      affectedCohort: 'desktop:PRICE_FRICTION:card',
      customerPhone: '9876543210',
      checkoutId: 'chk_mock_' + i + '_' + Date.now(),
      razorpayEventId: 'evt_mock_' + i + '_' + Date.now(),
      status: recovered ? 'RECOVERED' : 'EXPIRED',
      winningAction: 'TARGETED_DYNAMIC_DISCOUNT',
      winningENI: 1000 + (Math.random() * 5000),
      winningPRec: pRec,
      discountOffered: 500 + (Math.random() * 2000),
      isControl: false,
      candidatesJson: '[]'
    });
  }

  await db.insert(incidents).values(newIncidents);
  console.log('Successfully seeded 20 incidents.');
  process.exit(0);
}
seed().catch(console.error);
