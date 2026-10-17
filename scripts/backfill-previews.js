import { loadEnvFile } from 'node:process';
import { createPostgresStore } from '../backend/postgres-store.js';
import { createCloudFiles } from '../backend/cloud-files.js';
import { backfillPreviews, createPreviewStorage, hasStoredPreview } from '../backend/stored-previews.js';

try { loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const args = process.argv.slice(2);
const modes = args.filter(arg => ['--local', '--cloud'].includes(arg));
if (modes.length !== 1 || args.some(arg => !['--local', '--cloud', '--apply'].includes(arg))) {
  throw Error('Usage: npm run backfill:previews -- --local|--cloud [--apply]. Without --apply this is a dry run.');
}
const cloudMode = modes[0] === '--cloud';
const apply = args.includes('--apply');
console.log(`${apply ? 'Applying' : 'Dry run'}: ${cloudMode ? 'cloud' : 'local'} preview backfill.`);
if (!cloudMode) {
  // Share the running API's store/queue instead of writing its JSON from another process.
  if (!process.env.ADMIN_PASSWORD) throw Error('Set ADMIN_PASSWORD and start the local API before backfilling.');
  const port = process.env.PORT || '4000';
  if (!/^\d+$/.test(port)) throw Error('PORT must be a port number.');
  const base = `http://127.0.0.1:${port}/api`;
  const login = await fetch(base + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  if (!login.ok) throw Error(`Local admin login failed (${login.status}).`);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw Error('Local admin session was not created.');
  try {
    const response = await fetch(base + '/admin/notes', { headers: { cookie } });
    if (!response.ok) throw Error(`Could not read local catalogue (${response.status}).`);
    const notes = await response.json();
    const pending = notes.filter(note => note.file && !hasStoredPreview(note.file));
    const result = { pending: pending.length, completed: 0, failed: 0 };
    for (const note of pending) {
      if (!apply) { console.log(`Would generate preview: ${note.id}`); continue; }
      const saved = await fetch(base + '/admin/notes/' + encodeURIComponent(note.id) + '/preview', { method: 'POST', headers: { cookie } });
      if (saved.ok) { result.completed++; console.log(`Preview saved: ${note.id}`); }
      else { result.failed++; console.error(`Preview failed for ${note.id} (${saved.status}).`); }
    }
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } finally { await fetch(base + '/admin/logout', { method: 'POST', headers: { cookie } }); }
} else {
  if (!process.env.DATABASE_URL || !process.env.BLOB_STORE_ID || !process.env.VERCEL_OIDC_TOKEN) throw Error('Set DATABASE_URL, BLOB_STORE_ID and a fresh VERCEL_OIDC_TOKEN for cloud backfill.');
  const cloud = createCloudFiles({ storeId: process.env.BLOB_STORE_ID, oidcToken: process.env.VERCEL_OIDC_TOKEN });
  const store = await createPostgresStore(process.env.DATABASE_URL, { initialize: false });
  try {
    const data = await store.read();
    if (!data || !Array.isArray(data.notes)) throw Error('No existing catalogue found; nothing was changed.');
    const storage = createPreviewStorage({ cloud });
    const result = await backfillPreviews({ store, storage, readPdf: pathname => cloud.read(pathname), apply });
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } finally { await store.close(); }
}
