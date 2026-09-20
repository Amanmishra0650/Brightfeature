import { get, del } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAX_PDF_BYTES = 50 * 1024 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });
export function createCloudFiles(token) {
  async function open(pathname) {
    if (!/^notes\/[a-f0-9-]+\.pdf$/.test(pathname)) throw fail(400, 'Invalid stored PDF path.');
    const result = await get(pathname, { access: 'private', token });
    if (!result || result.statusCode !== 200) throw fail(404, 'The PDF is unavailable.');
    if (!new URL(result.blob.url).hostname.endsWith('.private.blob.vercel-storage.com')) throw fail(503, 'Configure a private Blob store before uploading paid PDFs.');
    if (result.blob.size > MAX_PDF_BYTES) { await result.stream.cancel(); throw fail(413, 'PDF must be 50 MB or smaller.'); }
    return result;
  }
  return {
    async token(pathname) { return generateClientTokenFromReadWriteToken({ token, pathname, allowedContentTypes: ['application/pdf'], maximumSizeInBytes: MAX_PDF_BYTES, validUntil: Date.now() + 3600000, addRandomSuffix: false, allowOverwrite: false }); },
    async read(pathname) {
      const { stream } = await open(pathname);
      const chunks = []; let size = 0;
      for await (const chunk of Readable.fromWeb(stream)) { size += chunk.length; if (size > MAX_PDF_BYTES) throw fail(413, 'PDF must be 50 MB or smaller.'); chunks.push(chunk); }
      return Buffer.concat(chunks);
    },
    async send(res, file) {
      const result = await open(file.storageName);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="notes.pdf"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}` });
      // Stream after authorisation instead of buffering a 50 MB function response.
      await pipeline(Readable.fromWeb(result.stream), res);
    },
    remove: pathname => del(pathname, { token }),
  };
}
