import 'dotenv/config';
import { db, merchants } from '@rize/db';

async function main() {
  console.log('Seeding merchant...');
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_secret_123';
  
  await db.insert(merchants).values({
    id: 'merchant_test_123',
    name: 'Test Merchant',
    webhookSecret,
    grossMarginRatio: 0.40,
    mdrRate: 0.02,
    maxDiscountCap: 0.15,
    minMarginFloor: 0.10,
    controlGroupRatio: 0.10,
  }).onConflictDoNothing();

  console.log('Merchant seeded successfully.');
  process.exit(0);
}

main().catch(console.error);
