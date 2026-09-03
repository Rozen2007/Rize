// Stub: deterministic, no API calls
export async function classifyFailure(
  errorCode: string,
  errorDesc: string
): Promise<{ reason: string; confidence: number }> {
  // Deterministic mapping based on error code
  const mapping: Record<string, { reason: string; confidence: number }> = {
    'DECLINED_BY_BANK': { reason: 'BANK_DECLINE', confidence: 0.95 },
    'CARD_EXPIRED': { reason: 'EXPIRED_CARD', confidence: 0.98 },
    'AUTH_TIMEOUT': { reason: 'AUTH_TIMEOUT', confidence: 0.90 },
    'HIGH_PRICE': { reason: 'PRICE_FRICTION', confidence: 0.85 },
  };
  return mapping[errorCode] || { reason: 'PRICE_FRICTION', confidence: 0.75 };
}

export async function classifyFailureWithTimeout(
  errorCode: string,
  errorDesc: string
): Promise<{ reason: string; confidence: number }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    // Try real API (when integrated)
    // const result = await realNemotronCall(errorCode, errorDesc, {
    //   signal: controller.signal
    // });
    
    // For now, just use the stub, but we still respect the structure
    const result = await classifyFailure(errorCode, errorDesc);

    clearTimeout(timeoutId);
    return result;
  } catch (err) {
    // Timeout or API failure -> fallback
    console.warn('classifyFailure timed out, using fallback');
    return classifyFailure(errorCode, errorDesc); // Stub implementation
  }
}

export async function generateCopy(
  actionType: string,
  amountINR: number
): Promise<string> {
  // Deterministic template
  if (actionType === 'TARGETED_DYNAMIC_DISCOUNT') {
    return `Complete your order for just ₹${amountINR.toFixed(0)}. Limited time offer!`;
  }
  return 'Complete your purchase securely.';
}

export async function generateCopyWithTimeout(
  actionType: string,
  amountINR: number
): Promise<string> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    const result = await generateCopy(actionType, amountINR);

    clearTimeout(timeoutId);
    return result;
  } catch (err) {
    console.warn('generateCopy timed out, using fallback');
    return generateCopy(actionType, amountINR);
  }
}
