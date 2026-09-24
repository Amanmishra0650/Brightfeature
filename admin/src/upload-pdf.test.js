import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadPdf } from './upload-pdf.js';

test('direct PDF upload uses the signed URL, reports progress, and rejects failed uploads', async t => {
  let request;
  class FakeRequest {
    upload = {};
    headers = {};
    constructor() { request = this; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(file) { this.file = file; }
  }
  const previous = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeRequest;
  t.after(() => {
    if (previous === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = previous;
  });
  const file = new Blob(['%PDF-fixture'], { type: 'application/pdf' });
  const percentages = [];
  const pending = uploadPdf('https://example.test/signed-upload', file, value => percentages.push(value));
  assert.equal(request.method, 'PUT');
  assert.equal(request.url, 'https://example.test/signed-upload');
  assert.equal(request.file, file);
  assert.deepEqual(request.headers, { 'Content-Type': 'application/pdf' });
  request.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
  assert.deepEqual(percentages, [50]);
  request.status = 200;
  request.onload();
  await pending;
  for (const event of ['onload', 'onerror', 'ontimeout', 'onabort']) {
    const failed = uploadPdf('https://example.test/signed-upload', file, () => {});
    request.status = 403;
    request[event]();
    await assert.rejects(failed, /upload/i);
  }
});
