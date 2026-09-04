import { classifyFailure, generateCopy } from './lib/ai/src/index.ts';

async function testGroq() {
  console.log('Testing Groq classification...');
  const res = await classifyFailure('HIGH_PRICE', 'User abandoned cart because price was too high');
  console.log('Classification Result:', res);
  
  console.log('Testing Groq copy generation...');
  const copy = await generateCopy('TARGETED_DYNAMIC_DISCOUNT', 500);
  console.log('Copy:', copy);
}

testGroq().catch(console.error);
