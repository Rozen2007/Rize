import 'dotenv/config';
import Razorpay from 'razorpay';
import { db, incidents } from '@rize/db';
import { eq } from 'drizzle-orm';

async function main() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret || key_id === 'your_test_key_id') {
    console.error('Please configure valid RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env');
    process.exit(1);
  }

  const razorpay = new Razorpay({ key_id, key_secret });

  // 1. Create a dummy incident
  const incidentId = `inc_${Date.now()}`;
  console.log(`Creating dummy incident ${incidentId}...`);
  
  await db.insert(incidents).values({
    id: incidentId,
    merchantId: 'merchant_test_123',
    razorpayEventId: `evt_${Date.now()}`,
    checkoutId: `chk_${Date.now()}`,
    orderValue: 500,
    failureReason: 'PRICE_FRICTION',
    device: 'desktop',
    paymentMethod: 'card',
    affectedCohort: 'Desktop:PRICE_FRICTION:Card',
    isControl: false,
    winningAction: 'PAYMENT_RECOVERY_LINK',
    winningENI: 15,
    winningPRec: 0.1,
    candidatesJson: '{}',
    status: 'PENDING'
  });

  // 2. Create the Razorpay test link
  console.log('Creating Razorpay payment link...');
  const expireBy = Math.floor(Date.now() / 1000) + 15 * 60; // 15 mins
  
  try {
    const paymentLink = await razorpay.paymentLink.create({
      amount: 500 * 100, // in paise
      currency: 'INR',
      accept_partial: false,
      description: 'Test Recovery Link',
      reference_id: incidentId,
      expire_by: expireBy,
      customer: {
        name: 'Test Customer',
        contact: '+919999999999',
        email: 'test@example.com'
      },
      notify: {
        sms: false,
        email: false
      }
    });

    console.log(`Payment link created: ${paymentLink.short_url}`);

    // 3. Update the incident with the link ID
    await db.update(incidents)
      .set({
        razorpayLinkId: paymentLink.id,
        razorpayLinkUrl: paymentLink.short_url,
        status: 'EXECUTED_PENDING_SETTLEMENT'
      })
      .where(eq(incidents.id, incidentId));

  } catch (error) {
    console.error('Error creating payment link:', error);
  }

  process.exit(0);
}

main().catch(console.error);
