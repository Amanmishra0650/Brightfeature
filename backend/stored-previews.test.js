import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './store.js';
import { createPreviewStorage, backfillPreviews, ensureStoredPreview } from './stored-previews.js';
import { pdfFixture } from '../scripts/pdf-fixture.js';
import { renderPreview } from './pdf-preview.js';

test('backfill defaults to dry run, preserves data and originals, and is repeatable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bright-backfill-'));
  try {
    const store = await createStore(dir);
    await mkdir(join(dir, 'uploads'));
    const pdf = pdfFixture();
    await writeFile(join(dir, 'uploads', 'abcd.pdf'), pdf);
    await store.update(data => { data.notes[0].file = { storageName: 'abcd.pdf', name: 'existing.pdf', pageCount: 4 }; });
    const before = await store.read();
    const storage = createPreviewStorage({ dataDir: dir });
    const options = { store, storage, readPdf: name => readFile(join(dir, 'uploads', name)), log: () => {} };
    assert.deepEqual(await backfillPreviews(options), { pending: 1, completed: 0, failed: 0 });
    assert.deepEqual(await store.read(), before);
    assert.deepEqual(await backfillPreviews({ ...options, apply: true }), { pending: 1, completed: 1, failed: 0 });
    const after = await store.read();
    assert.equal(after.notes[0].file.preview.pages.length, 4);
    const expected = structuredClone(before);
    expected.notes[0].file.preview = after.notes[0].file.preview;
    assert.deepEqual(after, expected);
    assert.deepEqual(await readFile(join(dir, 'uploads', 'abcd.pdf')), pdf);
    const first = await storage.read(after.notes[0].file.preview.pages[0]);
    assert.ok(first.length > 100);
    assert.deepEqual(await backfillPreviews({ ...options, apply: true }), { pending: 0, completed: 0, failed: 0 });
    assert.deepEqual(await store.read(), after);
    await assert.rejects(storage.read('../uploads/abcd.pdf'), /Invalid preview path/);
    await writeFile(join(dir, after.notes[0].file.preview.pages[0]), pdf);
    await assert.rejects(storage.read(after.notes[0].file.preview.pages[0]), /Preview unavailable/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('backfill does not overwrite a PDF replaced while it renders', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bright-backfill-race-'));
  try {
    const store = await createStore(dir);
    await store.update(data => { data.notes[0].file = { storageName: 'abcd.pdf' }; });
    const note = (await store.read()).notes[0];
    const storage = createPreviewStorage({ dataDir: dir });
    await assert.rejects(ensureStoredPreview({ store, storage, note, readPdf: async () => {
      await store.update(data => { data.notes[0].file = { storageName: 'dcba.pdf', name: 'replacement.pdf' }; });
      return pdfFixture();
    } }), error => error.status === 409);
    assert.deepEqual((await store.read()).notes[0].file, { storageName: 'dcba.pdf', name: 'replacement.pdf' });
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(join(dir, 'previews')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('existing two-page caches upgrade to cover plus three samples and remove obsolete PNGs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bright-preview-upgrade-'));
  try {
    const store = await createStore(dir);
    const storage = createPreviewStorage({ dataDir: dir });
    const pdf = pdfFixture();
    const rendered = await renderPreview(pdf);
    const previous = await storage.save({ pages: rendered.pages.slice(0, 2) });
    await store.update(data => { data.notes[0].file = { storageName: 'abcd.pdf', pageCount: 4, preview: previous }; });
    const before = await store.read();
    const note = before.notes[0];
    const file = await ensureStoredPreview({ store, storage, note, readPdf: async () => pdf });
    assert.equal(file.preview.pages.length, 4);
    assert.notEqual(file.preview.id, previous.id);
    for (let i = 0; i < 4; i++) assert.deepEqual(await storage.read(file.preview.pages[i]), rendered.pages[i]);
    for (const pathname of previous.pages) await assert.rejects(readFile(join(dir, pathname)), error => error.code === 'ENOENT');
    const after = await store.read();
    assert.deepEqual(after.orders, before.orders);
    assert.deepEqual(after.settings, before.settings);
    assert.deepEqual(after.notes.slice(1), before.notes.slice(1));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
