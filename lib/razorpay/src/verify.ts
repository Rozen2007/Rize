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

    const expectedBuf = Buffer.from(expectedSignature);
    const providedBuf = Buffer.from(signature);

    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }

    // Prevent timing attacks
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch (error) {
    return false;
  }
}
