import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });
import { generateWhyNotWithTimeout } from '@rize/ai';
async function test() {
  const result = await generateWhyNotWithTimeout('[]', { orderValue: 100, affectedCohort: 'mobile:PRICE_FRICTION:card', winningAction: 'TARGETED_DYNAMIC_DISCOUNT', discountOffered: 0.1, winningENI: 10, winningPRec: 0.8 });
  console.log('Result:', result);
}
test();
