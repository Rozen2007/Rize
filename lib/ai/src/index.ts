import OpenAI from 'openai';

let openaiClient: OpenAI | null = null;
function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.NEMOTRON_API_KEY || 'dummy_key',
      baseURL: process.env.NEMOTRON_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    });
  }
  return openaiClient;
}

// -----------------------------------------
// 1. Classify Failure
// -----------------------------------------
export async function classifyFailure(
  errorCode: string,
  errorDesc: string,
  options?: { signal?: AbortSignal }
): Promise<{ reason: string; confidence: number }> {
  const fallback = { reason: 'PRICE_FRICTION', confidence: 0.75 };
  
  // Deterministic mapping check
  const mapping: Record<string, { reason: string; confidence: number }> = {
    'DECLINED_BY_BANK': { reason: 'BANK_DECLINE', confidence: 0.95 },
    'CARD_EXPIRED': { reason: 'EXPIRED_CARD', confidence: 0.98 },
    'AUTH_TIMEOUT': { reason: 'AUTH_TIMEOUT', confidence: 0.90 },
    'HIGH_PRICE': { reason: 'PRICE_FRICTION', confidence: 0.85 },
  };

  if (mapping[errorCode]) {
    return mapping[errorCode];
  }

  if (!process.env.NEMOTRON_API_KEY || process.env.NEMOTRON_API_KEY === 'dummy_key') {
    return fallback;
  }

  try {
    const openai = getOpenAIClient();
    const prompt = `Classify this payment failure into one of these reasons: PRICE_FRICTION, BANK_DECLINE, AUTH_TIMEOUT, EXPIRED_CARD.
Error Code: ${errorCode}
Description: ${errorDesc}
Output JSON: { "reason": "...", "confidence": 0.0 to 1.0 }`;

    const response = await openai.chat.completions.create({
      model: process.env.NEMOTRON_MODEL || 'nvidia/nemotron-3.5-lightning:free',
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    }, { signal: options?.signal });

    const content = response.choices[0]?.message?.content || '{}';
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch?.[1] || content.substring(content.indexOf('{'));
    
    const parsed = JSON.parse(jsonStr);
    
    if (parsed.reason && typeof parsed.confidence === 'number') {
      return parsed;
    }
    return fallback;
  } catch (e) {
    console.warn('AI API Error (falling back to mock):', e);
    return fallback;
  }
}

export async function classifyFailureWithTimeout(
  errorCode: string,
  errorDesc: string
): Promise<{ reason: string; confidence: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500);

  try {
    const result = await classifyFailure(errorCode, errorDesc, { signal: controller.signal });
    return result;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn('classifyFailure timed out, using fallback');
    }
    return { reason: 'PRICE_FRICTION', confidence: 0.75 };
  } finally {
    clearTimeout(timeoutId);
  }
}

// -----------------------------------------
// 2. Generate Copy
// -----------------------------------------
export async function generateCopy(
  actionType: string,
  amountINR: number,
  options?: { signal?: AbortSignal }
): Promise<string> {
  const fallback = actionType === 'TARGETED_DYNAMIC_DISCOUNT' 
    ? `Complete your order for just ₹${amountINR.toFixed(0)}. Limited time offer!`
    : 'Complete your purchase securely.';

  if (!process.env.NEMOTRON_API_KEY || process.env.NEMOTRON_API_KEY === 'dummy_key') {
    return fallback;
  }

  try {
    const openai = getOpenAIClient();
    const prompt = `Write a short 1-sentence SMS to recover a payment.
Action Type: ${actionType}
Amount: ₹${amountINR.toFixed(0)}
Output JSON: { "copy": "..." }`;

    const response = await openai.chat.completions.create({
      model: process.env.NEMOTRON_MODEL || 'nvidia/nemotron-3.5-lightning:free',
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    }, { signal: options?.signal });

    const content = response.choices[0]?.message?.content || '{}';
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch?.[1] || content.substring(content.indexOf('{'));
    
    const parsed = JSON.parse(jsonStr);
    return parsed.copy || fallback;
  } catch (e) {
    console.warn('AI API Error (falling back to mock):', e);
    return fallback;
  }
}

export async function generateCopyWithTimeout(
  actionType: string,
  amountINR: number
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500);

  try {
    const result = await generateCopy(actionType, amountINR, { signal: controller.signal });
    return result;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn('generateCopy timed out, using fallback');
    }
    return actionType === 'TARGETED_DYNAMIC_DISCOUNT' 
      ? `Complete your order for just ₹${amountINR.toFixed(0)}. Limited time offer!`
      : 'Complete your purchase securely.';
  } finally {
    clearTimeout(timeoutId);
  }
}

// -----------------------------------------
// 3. Generate Why Not
// -----------------------------------------
export async function generateWhyNot(
  candidatesJson: string,
  incidentData: any,
  options?: { signal?: AbortSignal }
): Promise<string> {
  const discountStr = (incidentData.discountOffered * 100).toFixed(0);
  const eniStr = incidentData.winningENI.toFixed(2);
  const precStr = (incidentData.winningPRec * 100).toFixed(1);
  const fallback = `[FALLBACK] I offered this ${discountStr}% discount because the Expected Net Income was calculated as optimal ($${eniStr}) against the control group base rates, and my confidence score was highly defensible at ${precStr}%.`;

  if (!process.env.NEMOTRON_API_KEY || process.env.NEMOTRON_API_KEY === 'dummy_key') {
    console.warn('API Key missing, returning fallback');
    return fallback;
  }

  try {
    const openai = getOpenAIClient();
    const prompt = `You are the RIZE Autonomous Revenue Engine's explanation module. 
Explain in 2-3 short sentences why you made the following decision for a checkout incident:

Incident Context:
- Order Value: $${incidentData.orderValue}
- Cohort: ${incidentData.affectedCohort}
- Winning Action: ${incidentData.winningAction}
- Discount Offered: ${discountStr}%
- Expected Net Income (ENI): $${eniStr}
- Confidence (PRec): ${precStr}%
- Candidates Evaluated: ${candidatesJson}

Keep the tone professional, analytical, and concise. Defend the decision strictly on maximizing ENI and confidence.

CRITICAL INSTRUCTION: You must output ONLY a valid JSON object containing your final explanation. DO NOT output any reasoning, thinking process, or markdown blocks. Format:
{
  "explanation": "Your 2-3 sentence explanation here."
}`;

    const response = await openai.chat.completions.create({
      model: process.env.NEMOTRON_MODEL || 'nvidia/nemotron-3.5-lightning:free',
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a financial AI operating system explaining a targeted discount intervention to a merchant. You output only JSON.' },
        { role: 'user', content: prompt }
      ]
    }, { signal: options?.signal });

    const content = response.choices[0]?.message?.content || '{}';
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch?.[1] || content.substring(content.indexOf('{'));
    
    const parsed = JSON.parse(jsonStr);
    return parsed.explanation || fallback;
  } catch (e) {
    console.error('AI API Error (generateWhyNot):', e);
    return fallback;
  }
}

export async function generateWhyNotWithTimeout(
  candidatesJson: string,
  incidentData: any
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const result = await generateWhyNot(candidatesJson, incidentData, { signal: controller.signal });
    return result;
  } catch (err: any) {
    console.error('Timeout or other error in generateWhyNotWithTimeout:', err);
    const discountStr = (incidentData.discountOffered * 100).toFixed(0);
    const eniStr = incidentData.winningENI.toFixed(2);
    const precStr = (incidentData.winningPRec * 100).toFixed(1);
    return `[FALLBACK] I offered this ${discountStr}% discount because the Expected Net Income was calculated as optimal ($${eniStr}) against the control group base rates, and my confidence score was highly defensible at ${precStr}%.`;
  } finally {
    clearTimeout(timeoutId);
  }
}
