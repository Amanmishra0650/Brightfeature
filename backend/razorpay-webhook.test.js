import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './server.js';

test('Razorpay order.paid without payment entity is acknowledged without granting access', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bright-webhook-'));
  let fetchPaymentCalls = 0;
  const gateway = {
    config: { enabled: true, mode: 'test' },
    verifyWebhook(body, signature) {
      return signature === createHmac('sha256', 'webhook-test-secret').update(body).digest('hex');
    },
    fetchPayment() { fetchPaymentCalls++; throw Error('Should not fetch without payment ID'); },
  };
  const app = await createApp({ dataDir: dir, adminPassword: 'test-password-123', gateway });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    const event = JSON.stringify({
      event: 'order.paid',
      payload: { order: { entity: { id: 'order_without_payment_entity', status: 'paid' } } },
    });
    const response = await fetch('http://127.0.0.1:' + app.address().port + '/api/payments/webhook', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': createHmac('sha256', 'webhook-test-secret').update(event).digest('hex'),
        'Content-Type': 'application/json',
      },
      body: event,
    });
    assert.equal(response.status, 200);
    assert.equal(fetchPaymentCalls, 0);
  } finally {
    await new Promise(resolve => app.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
