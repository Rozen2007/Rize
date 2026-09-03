import crypto from 'crypto';

/**
 * verifyWebhookSignature
 *
 * Verifies the X-Razorpay-Signature header against the raw body using HMAC SHA256.
 * Uses timingSafeEqual to prevent timing attacks.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  if (!rawBody || !signature || !secret) {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature)
    );
  } catch (error) {
    return false;
  }
}
