import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderPreview } from './pdf-preview.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
export const previewPath = /^previews\/[a-f0-9-]+-[12]\.png$/;

export function hasStoredPreview(file) {
  return Boolean(file?.preview?.id && file.preview.pages?.length === Math.min(file.pageCount, 2)
    && file.preview.pages.length > 0 && file.preview.pages.every(path => previewPath.test(path)));
}

export function previewVersion(file) {
  return file ? createHash('sha256').update(file.storageName).digest('hex') : null;
}

export function previewUrl(note, page = 1) {
  if (!note.file) return null;
  const version = previewVersion(note.file);
  return `/api/notes/${encodeURIComponent(note.id)}/preview/${page}?v=${encodeURIComponent(version)}`;
}

export function createPreviewStorage({ dataDir, cloud }) {
  const check = pathname => { if (!previewPath.test(pathname)) throw fail(400, 'Invalid preview path.'); };
  const remove = async pathname => {
    check(pathname);
    if (cloud) return cloud.remove(pathname);
    try { await unlink(resolve(dataDir, pathname)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  return {
    async save(preview) {
      const id = randomUUID();
      const pages = preview.pages.map((_, i) => `previews/${id}-${i + 1}.png`);
      try {
        if (!cloud) await mkdir(resolve(dataDir, 'previews'), { recursive: true });
        for (let i = 0; i < pages.length; i++) {
          if (cloud) await cloud.writePreview(pages[i], preview.pages[i]);
          else await writeFile(resolve(dataDir, pages[i]), preview.pages[i], { flag: 'wx' });
        }
        return { id, pages };
      } catch (error) {
        await Promise.allSettled(pages.map(remove));
        throw error;
      }
    },
    async read(pathname) {
      check(pathname);
      const content = cloud ? await cloud.readPreview(pathname) : await readFile(resolve(dataDir, pathname));
      // Never serve an original PDF through a public image route, even with corrupt metadata.
      if (!content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw fail(404, 'Preview unavailable.');
      return content;
    },
    async remove(preview) {
      const results = await Promise.allSettled((preview?.pages || []).map(remove));
      for (const result of results) if (result.status === 'rejected') console.error('Preview cleanup failed:', result.reason.message);
    },
  };
}

// Images are written before metadata is committed. A concurrent upload/delete wins;
// backfilling never replaces another PDF or any unrelated catalogue/order fields.
export async function ensureStoredPreview({ store, note, storage, readPdf }) {
  if (!note?.file) throw fail(404, 'The admin has not uploaded a PDF for these notes yet.');
  if (hasStoredPreview(note.file)) return note.file;
  const rendered = await renderPreview(await readPdf(note.file.storageName));
  const preview = await storage.save(rendered);
  let retained = false;
  try {
    return await store.update(data => {
      const current = data.notes.find(item => item.id === note.id);
      if (current?.file?.storageName !== note.file.storageName) throw fail(409, 'PDF changed. Please refresh the page.');
      if (!hasStoredPreview(current.file)) {
        current.file.preview = preview;
        current.file.pageCount = rendered.pageCount;
        retained = true;
      }
      return current.file;
    });
  } catch (error) { retained = false; throw error; }
  finally { if (!retained) await storage.remove(preview); }
}

export async function backfillPreviews({ store, storage, readPdf, apply = false, log = console.log }) {
  const notes = (await store.read()).notes;
  const pending = notes.filter(note => note.file && !hasStoredPreview(note.file));
  const result = { pending: pending.length, completed: 0, failed: 0 };
  for (const note of pending) {
    if (!apply) { log(`Would generate preview: ${note.id}`); continue; }
    try { await ensureStoredPreview({ store, note, storage, readPdf }); result.completed++; log(`Preview saved: ${note.id}`); }
    catch (error) { result.failed++; log(`Preview failed for ${note.id}: ${error.message}`); }
  }
  return result;
}
