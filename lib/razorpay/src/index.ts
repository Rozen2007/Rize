import crypto from 'crypto';
import Razorpay from 'razorpay';

export class RazorpayError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'RazorpayError';
  }
}

export interface PaymentLinkResult {
  id: string;
  short_url: string;
}

export function verifyWebhookSignature(
  rawBodyString: string,
  signature: string,
  webhookSecret: string
): boolean {
  const signatureBuffer = Buffer.from(signature, 'utf8');
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBodyString)
    .digest('hex');
  
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  
  // CRITICAL: length check prevents throwing in timingSafeEqual
  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

export async function createPaymentLink(
  incidentId: string,
  orderValue: number,
  discountAmount: number,
  customerPhone?: string,
  keys?: { key_id: string; key_secret: string }
): Promise<PaymentLinkResult> {
  // Use provided keys, otherwise fallback to environment
  const key_id = keys?.key_id || process.env.RAZORPAY_KEY_ID;
  const key_secret = keys?.key_secret || process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    throw new RazorpayError('MISSING_CREDENTIALS', 'Razorpay API keys are not configured');
  }

  const razorpay = new Razorpay({ key_id, key_secret });
  
  const finalAmountPaise = Math.round((orderValue - discountAmount) * 100);
  const expireBy = Math.floor(Date.now() / 1000) + 15 * 60; // 15 minutes in future

  try {
    const payload: any = {
      amount: finalAmountPaise,
      currency: 'INR',
      expire_by: expireBy,
      notes: { incidentId },
      description: 'Complete your purchase securely',
      reminder_enable: false // We handle reminders/expiration manually
    };

    if (customerPhone) {
      payload.customer = { contact: customerPhone };
    }

    const response = await razorpay.paymentLink.create(payload);
    
    return {
      id: response.id,
      short_url: response.short_url
    };
  } catch (err: any) {
    if (err.statusCode === 429) {
      throw new RazorpayError('RATE_LIMITED', 'Too many requests to Razorpay API');
    }
    throw new RazorpayError('API_ERROR', err.message || 'Failed to create payment link');
  }
}
