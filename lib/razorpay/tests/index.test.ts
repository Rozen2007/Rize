import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { verifyWebhookSignature, createPaymentLink, RazorpayError } from '../src/index';

// Mock Razorpay SDK
vi.mock('razorpay', () => ({
  default: vi.fn().mockImplementation(() => ({
    paymentLink: {
      create: vi.fn().mockResolvedValue({
        id: 'plink_test_abc123',
        short_url: 'https://rzp.io/i/test',
        notes: { incidentId: 'inc_123' }
      })
    }
  }))
}));

import Razorpay from 'razorpay';

describe('verifyWebhookSignature', () => {
  const secret = 'test_secret_123';
  const rawBody = '{"event":"payment_link.paid"}';
  
  const generateValidSignature = (body: string, s: string) => 
    crypto.createHmac('sha256', s).update(body).digest('hex');

  it('4.A: Valid signature passes', () => {
    const validSignature = generateValidSignature(rawBody, secret);
    expect(verifyWebhookSignature(rawBody, validSignature, secret)).toBe(true);
  });

  it('4.B: Invalid signature rejects', () => {
    const invalidSignature = generateValidSignature(rawBody, 'wrong_secret');
    expect(verifyWebhookSignature(rawBody, invalidSignature, secret)).toBe(false);
  });

  it('4.C: Malformed/short signature returns false (doesn\'t throw)', () => {
    const malformedSignature = 'abc123short';
    // This should NOT throw due to timingSafeEqual length mismatch
    expect(() => verifyWebhookSignature(rawBody, malformedSignature, secret)).not.toThrow();
    expect(verifyWebhookSignature(rawBody, malformedSignature, secret)).toBe(false);
  });

  it('4.D: Empty rawBody rejects', () => {
    const signature = generateValidSignature(rawBody, secret);
    // Passing empty string when it shouldn't be
    expect(verifyWebhookSignature('', signature, secret)).toBe(false);
  });
});

describe('createPaymentLink', () => {
  const mockKeys = { key_id: 'test_id', key_secret: 'test_secret' };
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('4.E: createPaymentLink sets expire_by to exactly 15 min in future', async () => {
    const now = Math.floor(Date.now() / 1000);
    await createPaymentLink('inc_123', 1000, 100, undefined, mockKeys);
    
    // Get the instance returned by the mock constructor
    const razorpayInstance = (Razorpay as any).mock.results[0].value;
    const createCallPayload = razorpayInstance.paymentLink.create.mock.calls[0][0];
    
    const diff = createCallPayload.expire_by - now;
    expect(diff).toBeGreaterThanOrEqual(15 * 60 - 2); // Allow 2 sec execution variance
    expect(diff).toBeLessThanOrEqual(15 * 60 + 2);
  });

  it('4.F: createPaymentLink attaches incidentId to notes', async () => {
    await createPaymentLink('inc_456', 1000, 100, undefined, mockKeys);
    const razorpayInstance = (Razorpay as any).mock.results[0].value;
    const createCallPayload = razorpayInstance.paymentLink.create.mock.calls[0][0];
    
    expect(createCallPayload.notes.incidentId).toBe('inc_456');
  });

  it('4.G: createPaymentLink computes amount in paise correctly (orderValue - discount) * 100', async () => {
    await createPaymentLink('inc_123', 1500.50, 100.25, undefined, mockKeys);
    const razorpayInstance = (Razorpay as any).mock.results[0].value;
    const createCallPayload = razorpayInstance.paymentLink.create.mock.calls[0][0];
    
    // (1500.50 - 100.25) * 100 = 1400.25 * 100 = 140025
    expect(createCallPayload.amount).toBe(140025);
  });

  it('4.H: createPaymentLink with zero discount works', async () => {
    await createPaymentLink('inc_123', 1000, 0, undefined, mockKeys);
    const razorpayInstance = (Razorpay as any).mock.results[0].value;
    const createCallPayload = razorpayInstance.paymentLink.create.mock.calls[0][0];
    
    expect(createCallPayload.amount).toBe(100000);
  });

  it('4.I: Razorpay SDK is called with correct payload shape', async () => {
    await createPaymentLink('inc_123', 1000, 0, '+919876543210', mockKeys);
    const razorpayInstance = (Razorpay as any).mock.results[0].value;
    const createCallPayload = razorpayInstance.paymentLink.create.mock.calls[0][0];
    
    expect(createCallPayload.currency).toBe('INR');
    expect(createCallPayload.customer.contact).toBe('+919876543210');
    expect(createCallPayload.reminder_enable).toBe(false);
  });
  
  it('Handles RazorpayError rate limiting (statusCode 429)', async () => {
    // Override the mock for this specific test
    const mockCreate = vi.fn().mockRejectedValue({ statusCode: 429, message: 'Too many requests' });
    (Razorpay as any).mockImplementationOnce(() => ({
      paymentLink: { create: mockCreate }
    }));
    
    await expect(createPaymentLink('inc_123', 1000, 0, undefined, mockKeys))
      .rejects.toThrowError(new RazorpayError('RATE_LIMITED', 'Too many requests to Razorpay API'));
  });
});
