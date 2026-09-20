import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { razorpayGateway } from './payments.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('API protects admin changes and persists validated demo transactions', async () => {
  const { createApp } = await import('./server.js');
  const dir = await mkdtemp(join(tmpdir(), 'bright-test-'));
  let paymentStatus = 'captured';
  let paymentAmount = 14900;
  const gateway = razorpayGateway({ keyId: 'rzp_test_fixture', keySecret: 'secret-fixture', webhookSecret: 'webhook-fixture', request: async (url, options) => {
    if (url.endsWith('/orders')) { const body = JSON.parse(options.body); return Response.json({ id: 'order_fixture', amount: body.amount, currency: body.currency }); }
    return Response.json({ id: 'pay_fixture', order_id: 'order_fixture', amount: paymentAmount, currency: 'INR', status: paymentStatus, amount_refunded: 0 });
  } });
  const app = await createApp({ dataDir: dir, adminPassword: 'test-password-123', gateway });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = 'GET', body, cookie = '') {
    const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  try {
    const notes = await request('/notes');
    assert.equal(notes.body.length, 5);
    assert.equal((await request('/settings')).body.phone, '9161868600');
    assert.equal((await request('/admin/notes', 'POST', {})).status, 401);
    assert.equal((await request('/admin/login', 'POST', { password: 'wrong' })).status, 401);
    const login = await request('/admin/login', 'POST', { password: 'test-password-123' });
    assert.equal(login.status, 200);
    const cookie = login.cookie;
    const pdf = await readFile('public/sample-notes.pdf');
    async function upload(content, auth = cookie, type = 'application/pdf') {
      return fetch(base + '/api/admin/notes/' + notes.body[0].id + '/file', { method: 'PUT', headers: { cookie: auth, 'Content-Type': type, 'X-File-Name': encodeURIComponent('Exam notes.pdf') }, body: content });
    }
    assert.equal((await upload(pdf, '')).status, 401);
    assert.equal((await upload(Buffer.from('not a PDF'))).status, 400);
    assert.equal((await upload(pdf, cookie, 'text/plain')).status, 415);
    const uploaded = await upload(pdf);
    assert.equal(uploaded.status, 200);
    assert.equal((await uploaded.json()).file.name, 'Exam notes.pdf');
    assert.equal((await upload(Buffer.alloc(50 * 1024 * 1024 + 1))).status, 413);
    // A body above the former limit must reach PDF validation, not size rejection.
    assert.equal((await upload(Buffer.alloc(21 * 1024 * 1024))).status, 400);
    assert.equal((await upload(pdf)).status, 200);
    assert.equal((await readdir(join(dir, 'uploads'))).length, 1);
    const { createStore } = await import('./store.js');
    const reopened = await createStore(dir);
    assert.equal(reopened.read().notes[0].file.name, 'Exam notes.pdf');
    assert.equal((await fetch(base + '/api/admin/notes/' + notes.body[0].id + '/file')).status, 401);
    const edited = await request('/admin/notes/' + notes.body[0].id, 'PUT', notes.body[0], cookie);
    assert.equal(edited.body.file.name, 'Exam notes.pdf');
    const preview = await request('/notes/pet/preview');
    assert.equal(preview.status, 200);
    assert.equal(preview.body.pages.length, 1);
    assert.equal((await fetch(base + '/api/notes/pet/preview/3')).status, 404);
    assert.equal((await fetch(base + '/api/notes/pet/preview/1')).headers.get('content-type'), 'image/png');
    assert.equal((await request('/admin/notes', 'POST', { title: '' }, cookie)).status, 400);
    const added = await request('/admin/notes', 'POST', { ...notes.body[0], title: 'New demo notes', id: undefined }, cookie);
    assert.equal(added.status, 201);
    const hidden = await request('/admin/notes/' + added.body.id, 'PUT', { ...added.body, published: false }, cookie);
    assert.equal(hidden.status, 200);
    assert.equal((await request('/notes')).body.length, 5);
    assert.equal((await request('/orders', 'POST', { noteId: notes.body[0].id })).status, 401);
    assert.equal((await request('/session', 'POST', { name: 'A', email: 'bad' })).status, 400);
    const student = await request('/session', 'POST', { name: 'Test Student', email: 'student@example.com' });
    const order = await request('/orders', 'POST', { noteId: notes.body[0].id, amount: 1 }, student.cookie);
    assert.equal(order.status, 201);
    assert.equal(order.body.amount, notes.body[0].price);
    assert.equal(order.body.status, 'Pending');
    const downloadPath = base + '/api/orders/' + order.body.id + '/download';
    assert.equal((await fetch(downloadPath)).status, 401);
    assert.equal((await fetch(downloadPath, { headers: { cookie: student.cookie } })).status, 403);
    assert.equal((await request('/admin/orders/' + order.body.id, 'PUT', { status: 'Paid' }, cookie)).status, 400);
    const paymentOrder = await request('/payments/create', 'POST', { orderId: order.body.id, amount: 1 }, student.cookie);
    assert.equal(paymentOrder.body.amount, 14900);
    const proof = { orderId: order.body.id, razorpay_order_id: 'order_fixture', razorpay_payment_id: 'pay_fixture', razorpay_signature: 'forged' };
    assert.equal((await request('/payments/verify', 'POST', proof, student.cookie)).status, 400);
    proof.razorpay_signature = createHmac('sha256', 'secret-fixture').update('order_fixture|pay_fixture').digest('hex');
    paymentStatus = 'authorized';
    assert.equal((await request('/payments/verify', 'POST', proof, student.cookie)).status, 400);
    paymentStatus = 'captured';
    paymentAmount = 1;
    assert.equal((await request('/payments/verify', 'POST', proof, student.cookie)).status, 400);
    paymentAmount = 14900;
    assert.equal((await request('/payments/verify', 'POST', proof, student.cookie)).body.status, 'Paid');
    assert.equal((await request('/payments/verify', 'POST', proof, student.cookie)).body.status, 'Paid');
    const download = await fetch(downloadPath, { headers: { cookie: student.cookie } });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
    const second = await createApp({ dataDir: dir, adminPassword: 'test-password-123', gateway });
    await new Promise(resolve => second.listen(0, '127.0.0.1', resolve));
    try {
      const resumed = await fetch(`http://127.0.0.1:${second.address().port}/api/orders/${order.body.id}/download`, { headers: { cookie: student.cookie } });
      assert.equal(resumed.status, 200);
      assert.deepEqual(Buffer.from(await resumed.arrayBuffer()), pdf);
    } finally { await new Promise(resolve => second.close(resolve)); }
    const event = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_fixture', order_id: 'order_fixture' } } } });
    assert.equal((await fetch(base + '/api/payments/webhook', { method: 'POST', body: event })).status, 401);
    const webhook = await fetch(base + '/api/payments/webhook', { method: 'POST', headers: { 'x-razorpay-signature': createHmac('sha256', 'webhook-fixture').update(event).digest('hex') }, body: event });
    assert.equal(webhook.status, 200);
    assert.equal((await request('/orders', 'GET', undefined, student.cookie)).body.length, 1);
    const other = await request('/session', 'POST', { name: 'Other Student', email: 'student@example.com' });
    assert.equal((await request('/orders', 'GET', undefined, other.cookie)).body.length, 0);
    assert.equal((await fetch(downloadPath, { headers: { cookie: other.cookie } })).status, 404);
    await request('/admin/orders/' + order.body.id, 'PUT', { status: 'Cancelled' }, cookie);
    assert.equal((await fetch(downloadPath, { headers: { cookie: student.cookie } })).status, 403);
    assert.equal((await request('/admin/orders/' + order.body.id, 'PUT', { status: 'Demo access' }, cookie)).status, 400);
    assert.equal((await request('/orders', 'POST', { noteId: added.body.id }, student.cookie)).status, 404);
    assert.equal((await request('/admin/notes/' + added.body.id, 'DELETE', undefined, cookie)).status, 200);
    assert.equal((await request('/admin/settings', 'PUT', { offerTitle: 'Weekend offer', offerSubtitle: 'Demo offer', discount: 40 }, cookie)).status, 200);
    assert.equal((await request('/settings')).body.discount, 40);
    assert.equal((await request('/admin/orders/' + order.body.id, 'PUT', { status: 'invalid' }, cookie)).status, 400);
    await request('/admin/logout', 'POST', {}, cookie);
    assert.equal((await request('/admin/notes', 'GET', undefined, cookie)).status, 401);
    const saved = JSON.parse(await readFile(join(dir, 'store.json'), 'utf8'));
    assert.equal(saved.settings.discount, 40);
    assert.ok(saved.orders.some(item => item.id === order.body.id));
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
