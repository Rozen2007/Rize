import { createRazorpayLink } from './lib/razorpay/src/client.ts';
import 'dotenv/config';

async function run() {
  try {
    const linkResult = await createRazorpayLink(
      process.env.RAZORPAY_KEY_ID || 'test',
      process.env.RAZORPAY_KEY_SECRET || 'test',
      {
        reference_id: "test",
        amount: 60000,
        currency: 'INR',
        accept_partial: false,
        description: "test",
        customer: {
          name: 'Demo User',
          contact: '9999999999',
          email: 'demo@example.com'
        },
        notify: { sms: true, email: false },
        reminder_enable: false,
        callback_url: 'https://example.com/callback',
        callback_method: 'get'
      }
    );
    console.log(linkResult);
  } catch(e: any) {
    console.error(e.message);
  }
}
run();
