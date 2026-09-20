import { createHmac, timingSafeEqual } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
export function validSignature(message, signature, secret) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature || '')) return false;
  return timingSafeEqual(createHmac('sha256', secret).update(message).digest(), Buffer.from(signature, 'hex'));
}
export function razorpayGateway({ keyId = process.env.RAZORPAY_KEY_ID, keySecret = process.env.RAZORPAY_KEY_SECRET, webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET, request = fetch } = {}) {
  const enabled = Boolean(keyId && keySecret);
  const mode = enabled ? keyId.startsWith('rzp_live_') ? 'live' : 'test' : 'unconfigured';
  async function call(path, body) {
    if (!enabled) throw fail(503, 'Payments are not configured yet. Please contact the institute.');
    const response = await request('https://api.razorpay.com/v1/' + path, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw fail(502, 'Razorpay could not complete this request. Please try again.');
    return response.json();
  }
  return {
    config: { enabled, mode }, keyId,
    createOrder: order => call('orders', { amount: order.amount * 100, currency: 'INR', receipt: order.id }),
    fetchPayment: id => call('payments/' + encodeURIComponent(id)),
    verify: (orderId, paymentId, signature) => validSignature(`${orderId}|${paymentId}`, signature, keySecret),
    verifyWebhook: (body, signature) => validSignature(body, signature, webhookSecret),
  };
}

export function capturedPaymentMatches(payment, order) {
  return payment.status === 'captured' && payment.order_id === order.gatewayOrderId && payment.amount === order.amount * 100 && payment.currency === 'INR' && !payment.amount_refunded;
}
