import { loadEnvFile } from 'node:process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { put, del } from '@vercel/blob';
import { createPostgresStore } from '../backend/postgres-store.js';
import { renderPreview } from '../backend/pdf-preview.js';
import { seedData } from '../backend/seed.js';
import { isDeepStrictEqual } from 'node:util';

try { loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!process.env.DATABASE_URL || !process.env.BLOB_STORE_ID || !process.env.VERCEL_OIDC_TOKEN) throw Error('Set DATABASE_URL, BLOB_STORE_ID and VERCEL_OIDC_TOKEN before migrating.');
const source = JSON.parse(await readFile('backend/data/store.json', 'utf8'));
const store = await createPostgresStore(process.env.DATABASE_URL);
const uploaded = []; let committed = false;
const pristine = data => !data.orders.length && !data.localMigration && isDeepStrictEqual(data.notes, seedData().notes) && isDeepStrictEqual(data.settings, seedData().settings);
try {
  const target = await store.read();
  if (!pristine(target)) throw Error('Cloud data already exists. Migration refuses to overwrite it.');
  const notes = [];
  for (const note of source.notes) {
    if (!note.file) { notes.push(note); continue; }
    if (!/^[a-f0-9-]+\.pdf$/.test(note.file.storageName)) throw Error('Expected local PDF storage path.');
    const content = await readFile('backend/data/uploads/' + note.file.storageName);
    if (content.length > 50 * 1024 * 1024) throw Error('An uploaded PDF exceeds 50 MB.');
    const preview = await renderPreview(content);
    const pathname = 'notes/' + randomUUID() + '.pdf';
    const blob = await put(pathname, content, { access: 'private', contentType: 'application/pdf', addRandomSuffix: false, multipart: true });
    uploaded.push(blob.url);
    notes.push({ ...note, file: { ...note.file, storageName: pathname, size: content.length, pageCount: preview.pageCount } });
  }
  await store.update(data => {
    if (!pristine(data)) throw Error('Cloud data changed during migration; nothing was replaced.');
    data.notes = notes;
    data.settings = source.settings;
    data.orders = source.orders;
    data.localMigration = { completedAt: new Date().toISOString(), noteCount: notes.length, fileCount: uploaded.length };
  });
  committed = true;
  console.log(`Migrated ${notes.length} notes, ${uploaded.length} private PDFs and ${source.orders.length} order records. Local files were preserved.`);
} finally {
  if (!committed && uploaded.length) await del(uploaded).catch(() => {});
  await store.close();
}
