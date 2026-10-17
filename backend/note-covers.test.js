import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './server.js';
import { pdfFixture } from '../scripts/pdf-fixture.js';
import { renderPreview } from './pdf-preview.js';
import { createStore } from './store.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('covers persist across restarts, change on replacement, and never expose PDFs', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bright-covers-'));
  const password = 'cover-test-password';
  let server;
  async function start() {
    server = await createApp({ dataDir, adminPassword: password, databaseUrl: '', blobStoreId: '', oidcToken: '' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }
  try {
    let base = await start();
    const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const upload = content => fetch(base + '/api/admin/notes/pet/file', { method: 'PUT', headers: { cookie, 'Content-Type': 'application/pdf', 'X-File-Name': 'actual.pdf' }, body: content });
    const initial = await (await fetch(base + '/api/notes')).json();
    assert.equal(initial[0].coverUrl, null);
    assert.equal((await upload(pdfFixture())).status, 200);
    const notes = await (await fetch(base + '/api/notes')).json();
    assert.match(notes[0].coverUrl, /^\/api\/notes\/pet\/preview\/1\?v=.+/);
    assert.equal(notes[0].file, undefined);
    assert.ok(!JSON.stringify(notes).includes('storageName'));
    const first = await fetch(base + notes[0].coverUrl);
    assert.equal(first.headers.get('content-type'), 'image/png');
    const firstBytes = Buffer.from(await first.arrayBuffer());
    const rendered = await renderPreview(pdfFixture());
    assert.deepEqual(firstBytes, rendered.pages[0]);
    assert.notDeepEqual(firstBytes, rendered.pages[1]);
    const sample = await (await fetch(base + '/api/notes/pet/preview')).json();
    assert.equal(sample.startPage, 2);
    assert.equal(sample.pages.length, 3);
    for (const [i, url] of sample.pages.entries()) {
      assert.match(url, new RegExp(`/preview/${i + 2}\\?`));
      assert.deepEqual(Buffer.from(await (await fetch(base + url)).arrayBuffer()), rendered.pages[i + 1]);
    }
    assert.deepEqual(firstBytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal((await fetch(base + '/api/notes/pet/preview/5')).status, 404);
    assert.equal((await fetch(base + '/api/admin/notes/pet/file')).status, 401);
    const replacement = await upload(await readFile('public/sample-notes.pdf'));
    assert.equal(replacement.status, 200);
    const replacementNote = await replacement.json();
    const changed = (await (await fetch(base + '/api/notes')).json())[0];
    assert.notEqual(changed.coverUrl, notes[0].coverUrl);
    assert.equal((await fetch(base + notes[0].coverUrl)).status, 404);
    const cover = Buffer.from(await (await fetch(base + changed.coverUrl)).arrayBuffer());
    assert.notDeepEqual(cover, firstBytes);
    // Remove the original and restart: a cover request must read the stored PNG, not render a PDF.
    await unlink(join(dataDir, 'uploads', replacementNote.file.storageName));
    await new Promise(resolve => server.close(resolve));
    base = await start();
    assert.deepEqual(Buffer.from(await (await fetch(base + changed.coverUrl)).arrayBuffer()), cover);
    const metadata = await (await fetch(base + '/api/notes/pet/preview')).json();
    assert.equal(metadata.pages.length, 0);
    assert.equal(metadata.startPage, 2);
    assert.equal((await fetch(base + '/api/notes/stet/preview/1')).status, 404);
    const hidden = await fetch(base + '/api/admin/notes/pet', { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...changed, published: false }) });
    assert.equal(hidden.status, 200);
    assert.equal((await fetch(base + changed.coverUrl)).status, 404);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('legacy PDF covers backfill once through the public route and local command preserves catalogue data', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bright-legacy-covers-'));
  let server;
  try {
    const store = await createStore(dataDir);
    await mkdir(join(dataDir, 'uploads'));
    const original = pdfFixture();
    await writeFile(join(dataDir, 'uploads', 'abcd.pdf'), original);
    await store.update(data => {
      data.notes[0].file = { storageName: 'abcd.pdf', name: 'legacy.pdf', pageCount: 4 };
      data.notes[1].file = { storageName: 'abcd.pdf', name: 'draft.pdf', pageCount: 4 };
      data.notes[1].published = false;
    });
    const before = await store.read();
    server = await createApp({ dataDir, adminPassword: 'legacy-test-password', databaseUrl: '', blobStoreId: '', oidcToken: '' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const notes = await (await fetch(base + '/api/notes')).json();
    const url = notes[0].coverUrl;
    assert.ok(url && !url.includes('abcd.pdf'));
    assert.equal((await fetch(base + url)).status, 200);
    // The catalogue URL stays stable when a legacy preview is first persisted.
    assert.equal((await (await fetch(base + '/api/notes')).json())[0].coverUrl, url);
    assert.equal((await fetch(base + url)).status, 200);
    assert.equal((await fetch(base + '/api/notes/ctet/preview/1')).status, 404);
    const run = async (...args) => promisify(execFile)(process.execPath, ['scripts/backfill-previews.js', '--local', ...args], {
      env: { ...process.env, ADMIN_PASSWORD: 'legacy-test-password', PORT: String(server.address().port) },
    });
    const dry = await run();
    assert.match(dry.stdout, /"pending":1,"completed":0,"failed":0/);
    assert.equal(JSON.parse(await readFile(join(dataDir, 'store.json'))).notes[1].file.preview, undefined);
    const applied = await run('--apply');
    assert.match(applied.stdout, /"pending":1,"completed":1,"failed":0/);
    const again = await run('--apply');
    assert.match(again.stdout, /"pending":0,"completed":0,"failed":0/);
    const after = JSON.parse(await readFile(join(dataDir, 'store.json')));
    for (let i = 0; i < 2; i++) {
      assert.equal(after.notes[i].file.preview.pages.length, 4);
      delete after.notes[i].file.preview;
    }
    assert.deepEqual(after.notes, before.notes);
    assert.deepEqual(after.orders, before.orders);
    assert.deepEqual(after.settings, before.settings);
    assert.deepEqual(await readFile(join(dataDir, 'uploads', 'abcd.pdf')), original);
    assert.deepEqual(after.sessions, {});
    assert.equal((await fetch(base + '/api/admin/notes/pet/preview', { method: 'POST' })).status, 401);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
