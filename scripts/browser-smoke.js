import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createApp } from '../backend/server.js';
import { razorpayGateway } from '../backend/payments.js';
import { pdfFixture } from './pdf-fixture.js';

const dataDir = await mkdtemp(join(tmpdir(), 'bright-browser-'));
const uploadedPdf = pdfFixture();
// Substitute only the external gateway. All application security checks run.
const gateway = razorpayGateway({ keyId: 'rzp_test_browser', keySecret: 'browser-secret', request: async (url, options) => {
  if (url.endsWith('/orders')) return Response.json({ ...JSON.parse(options.body), id: 'order_browser' });
  return Response.json({ id: 'pay_browser', order_id: 'order_browser', amount: 24900, currency: 'INR', status: 'captured', amount_refunded: 0 });
} });
const server = await createApp({ dataDir, gateway, adminPassword: 'BrightFuture@2026', databaseUrl: '', blobStoreId: '', oidcToken: '' });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  let channel = process.env.BROWSER_CHANNEL;
  if (!channel && process.platform === 'win32') {
    try { await access('C:/Program Files/Google/Chrome/Application/chrome.exe'); channel = 'chrome'; } catch {}
  }
  browser = await chromium.launch({ ...(channel ? { channel } : {}) });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/admin/');
  await page.getByLabel('Password', { exact: true }).fill('BrightFuture@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Catalogue', exact: true }).click();
  await page.getByRole('button', { name: 'Upload PDF for CTET Preparation Notes', exact: true }).click();
  await page.getByLabel('Notes PDF', { exact: true }).setInputFiles({ name: 'sample-notes.pdf', mimeType: 'application/pdf', buffer: uploadedPdf });
  await page.getByRole('button', { name: 'Upload PDF', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'CTET Preparation Notes' })).toContainText('sample-notes.pdf');
  const beforeReplacement = (await (await page.request.get(base + '/api/notes')).json()).find(note => note.id === 'ctet').coverUrl;
  await page.getByRole('button', { name: 'Upload PDF for CTET Preparation Notes', exact: true }).click();
  await page.getByLabel('Notes PDF', { exact: true }).setInputFiles({ name: 'Updated CTET.pdf', mimeType: 'application/pdf', buffer: uploadedPdf });
  await page.getByRole('button', { name: 'Upload PDF', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'CTET Preparation Notes' })).toContainText('Updated CTET.pdf');
  const afterReplacement = (await (await page.request.get(base + '/api/notes')).json()).find(note => note.id === 'ctet').coverUrl;
  assert.notEqual(beforeReplacement, afterReplacement);
  assert.equal((await page.request.get(base + beforeReplacement)).status(), 404);
  await page.getByRole('button', { name: 'Add notes', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Browser Test Notes');
  await page.getByLabel('Description', { exact: true }).fill('Test notes description');
  await page.getByLabel('Topics', { exact: true }).fill('Reasoning and practice');
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Browser Test Notes', exact: true }).click();
  await page.getByLabel('Published on storefront').uncheck();
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Browser Test Notes' })).toContainText('Draft');
  await page.getByRole('button', { name: 'Delete Browser Test Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete Browser Test Notes', exact: true })).toHaveCount(0);
  await page.goto(base);
  const ctetCard = page.locator('.note-card').filter({ hasText: 'CTET Preparation Notes' });
  const cardCover = ctetCard.getByRole('img', { name: 'First page of CTET Preparation Notes', exact: true });
  await expect(cardCover).toBeVisible();
  await expect(cardCover).toHaveJSProperty('naturalWidth', 1000);
  assert.equal(await cardCover.evaluate(img => getComputedStyle(img).objectFit), 'cover');
  await expect(page.locator('.note-cover-unavailable')).toHaveCount(4);
  assert.equal(await page.locator('.card-art .book-cover').count(), 0);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'All Notes', exact: true }).click();
  await expect(cardCover).toBeVisible();
  // A failed cover keeps its card and reserved image area intact.
  const coverHeight = await ctetCard.locator('.card-art').evaluate(el => el.offsetHeight);
  await page.route('**/api/notes/ctet/preview/1?*', route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable' }));
  await page.reload();
  await expect(ctetCard.locator('.note-cover-unavailable')).toContainText('Preview unavailable');
  assert.equal(await ctetCard.locator('.card-art').evaluate(el => el.offsetHeight), coverHeight);
  await expect(ctetCard.getByRole('button', { name: 'Buy now' })).toBeVisible();
  await page.unroute('**/api/notes/ctet/preview/1?*');
  // Every category uses its own uploaded first page; include a landscape PDF.
  const otherIds = ['pet', 'stet', 'bpsc', 'si'];
  for (const [index, id] of otherIds.entries()) {
    const response = await page.request.put(base + `/api/admin/notes/${id}/file`, {
      headers: { 'Content-Type': 'application/pdf', 'X-File-Name': `${id}.pdf` },
      data: pdfFixture({ ...(id === 'bpsc' ? { width: 792, height: 612 } : {}), tint: (index + 1) / 10 }),
    });
    assert.equal(response.status(), 200);
  }
  await page.reload();
  const covers = page.locator('.note-cover img');
  await expect(covers).toHaveCount(5);
  for (const img of await covers.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect(img).toBeVisible();
    await expect(img).toHaveJSProperty('naturalWidth', 1000);
    assert.equal(await img.evaluate(el => getComputedStyle(el).objectFit), 'cover');
    assert.equal(await img.evaluate(el => {
      const image = el.getBoundingClientRect();
      const frame = el.closest('.card-art').getBoundingClientRect();
      return Math.abs(image.top - frame.top) <= 1 && Math.abs(image.bottom - frame.bottom) <= 1 && Math.abs(image.left - frame.left) <= 1 && Math.abs(image.right - frame.right) <= 1;
    }), true, 'The PDF image must fill the entire card cover area');
  }
  const landscape = page.getByRole('img', { name: 'First page of BPSC School Teacher TRE 4.0', exact: true });
  assert.ok(await landscape.evaluate(img => img.naturalWidth > img.naturalHeight));
  const sources = await covers.evaluateAll(images => images.map(img => img.getAttribute('src')));
  assert.equal(new Set(sources).size, 5);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'All Notes', exact: true }).click();
  await mkdir('test-results', { recursive: true });
  await page.locator('#notes').screenshot({ path: 'test-results/covers-desktop.png' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('#notes').screenshot({ path: 'test-results/covers-mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const img of await covers.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect(img).toBeVisible();
    assert.equal(await img.evaluate(el => getComputedStyle(el).objectFit), 'cover');
    assert.equal(await img.evaluate(el => {
      const image = el.getBoundingClientRect();
      const frame = el.closest('.card-art').getBoundingClientRect();
      return Math.abs(image.top - frame.top) <= 1 && Math.abs(image.bottom - frame.bottom) <= 1 && Math.abs(image.left - frame.left) <= 1 && Math.abs(image.right - frame.right) <= 1;
    }), true, 'Mobile PDF images must fill the entire card cover area');
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  // Delay the image to verify the loading state before the real cover arrives.
  let releaseCover;
  const coverGate = new Promise(resolve => { releaseCover = resolve; });
  await page.route('**/api/notes/ctet/preview/1?*', async route => { await coverGate; await route.continue(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ctetCard.scrollIntoViewIfNeeded();
  await expect(ctetCard.getByRole('status')).toContainText('Loading preview');
  releaseCover();
  await expect(cardCover).toBeVisible();
  await page.unroute('**/api/notes/ctet/preview/1?*');
  await page.getByRole('textbox', { name: 'Search notes' }).fill('CTET');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const previewImage = page.getByRole('img', { name: 'Preview page 1 of CTET Preparation Notes', exact: true });
  await expect(previewImage).toBeVisible();
  await expect(previewImage).toHaveJSProperty('naturalWidth', 1000);
  await expect(page.getByRole('img', { name: 'Preview page 2 of CTET Preparation Notes', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pages 3–4 are locked', exact: true })).toBeVisible();
  await expect(page.locator('.pdf-preview img')).toHaveCount(2);
  assert.equal((await page.request.get(base + '/api/notes/ctet/preview/3')).status(), 404);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Buy now', exact: true }).click();
  await page.getByLabel('Your name').fill('Browser Student');
  await page.getByLabel('Email address').fill('browser@example.com');
  const signature = createHmac('sha256', 'browser-secret').update('order_browser|pay_browser').digest('hex');
  await page.route('https://checkout.razorpay.com/v1/checkout.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.Razorpay = class { constructor(options) { this.options = options; } open() { this.options.handler({razorpay_order_id:'order_browser',razorpay_payment_id:'pay_browser',razorpay_signature:'${signature}'}); } };` }));
  await page.getByRole('button', { name: /Pay .* with Razorpay/ }).click();
  await page.getByRole('heading', { name: 'Your next chapter is ready' }).waitFor();
  const link = page.getByRole('link', { name: 'Download notes', exact: true });
  const download = await page.request.get(base + await link.getAttribute('href'));
  assert.equal(download.status(), 200);
  assert.deepEqual(await download.body(), uploadedPdf);
  await page.getByRole('button', { name: 'Go to My Library' }).click();
  await expect(page.getByRole('link', { name: 'Download notes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(cardCover).toBeVisible();
  assert.equal(await cardCover.evaluate(img => getComputedStyle(img).objectFit), 'cover');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await page.goto(base + '/admin/');
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: covers for all five categories, Home/All Notes, portrait/landscape, loading/error placeholders, mobile cards, admin upload/replacement/CRUD, PDF preview and authorised download/payment flow.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); }
