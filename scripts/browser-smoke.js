import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
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
const server = await createApp({ dataDir, gateway });
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
  await page.getByRole('button', { name: 'Upload PDF for CTET Preparation Notes', exact: true }).click();
  await page.getByLabel('Notes PDF', { exact: true }).setInputFiles({ name: 'Updated CTET.pdf', mimeType: 'application/pdf', buffer: uploadedPdf });
  await page.getByRole('button', { name: 'Upload PDF', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'CTET Preparation Notes' })).toContainText('Updated CTET.pdf');
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
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await page.goto(base + '/admin/');
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: admin CRUD/upload/replacement, actual PDF preview, search, Razorpay flow (simulated gateway), original PDF download/library and mobile layouts.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); }
