export interface CreatePaymentLinkRequest {
  amount: number;
  currency: string;
  accept_partial: boolean;
  reference_id: string;
  description: string;
  customer: {
    name: string;
    contact: string;
    email: string;
  };
  notify: {
    sms: boolean;
    email: boolean;
  };
  reminder_enable: boolean;
  callback_url: string;
  callback_method: string;
}

export interface PaymentLinkResponse {
  id: string;
  short_url: string;
  status: string;
}

/**
 * createRazorpayLink
 *
 * Calls the Razorpay API to generate a payment link.
 * Throws if auth fails or network error.
 */
export async function createRazorpayLink(
  keyId: string,
  keySecret: string,
  payload: CreatePaymentLinkRequest
): Promise<PaymentLinkResponse> {
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Razorpay API Error: ${res.status} - ${errorText}`);
  }

  return res.json() as Promise<PaymentLinkResponse>;
}
