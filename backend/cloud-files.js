import { get, put, del, issueSignedToken, presignUrl } from '@vercel/blob';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getRequestOidcToken } from './oidc-context.js';

export const MAX_PDF_BYTES = 50 * 1024 * 1024;

const fail = (status, message) =>
  Object.assign(new Error(message), { status });

export function createCloudFiles({ oidcToken, storeId }) {
  // The application is cached across requests; use the current rotated token.
  const auth = () => ({
    oidcToken: getRequestOidcToken() || process.env.VERCEL_OIDC_TOKEN || oidcToken,
    storeId,
  });

  async function open(pathname) {
    if (!/^notes\/[a-f0-9-]+\.pdf$/.test(pathname)) {
      throw fail(400, 'Invalid stored PDF path.');
    }

    const result = await get(pathname, {
      access: 'private',
      ...auth(),
    });

    if (!result || result.statusCode !== 200) {
      throw fail(404, 'The PDF is unavailable.');
    }

    if (
      !new URL(result.blob.url).hostname.endsWith(
        '.private.blob.vercel-storage.com'
      )
    ) {
      throw fail(
        503,
        'Configure a private Blob store before uploading paid PDFs.'
      );
    }

    if (result.blob.size > MAX_PDF_BYTES) {
      await result.stream.cancel();
      throw fail(413, 'PDF must be 50 MB or smaller.');
    }

    return result;
  }

  return {
    async writePreview(pathname, content) {
      if (!/^previews\/[a-f0-9-]+-[1-4]\.png$/.test(pathname)) throw fail(400, 'Invalid preview path.');
      await put(pathname, content, { access: 'private', contentType: 'image/png', addRandomSuffix: false, allowOverwrite: false, ...auth() });
    },

    async readPreview(pathname) {
      if (!/^previews\/[a-f0-9-]+-[1-4]\.png$/.test(pathname)) throw fail(400, 'Invalid preview path.');
      const result = await get(pathname, { access: 'private', ...auth() });
      if (!result || result.statusCode !== 200) throw fail(404, 'Preview unavailable.');
      if (!new URL(result.blob.url).hostname.endsWith('.private.blob.vercel-storage.com')) {
        await result.stream.cancel();
        throw fail(503, 'Configure a private Blob store for previews.');
      }
      const chunks = []; let size = 0;
      if (result.blob.size > 10 * 1024 * 1024) { await result.stream.cancel(); throw fail(413, 'Preview is too large.'); }
      for await (const chunk of Readable.fromWeb(result.stream)) {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) throw fail(413, 'Preview is too large.');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },

    async uploadUrl(pathname) {
      if (!/^notes\/[a-f0-9-]+\.pdf$/.test(pathname)) throw fail(400, 'Invalid stored PDF path.');
      const token = await issueSignedToken({
        pathname,
        operations: ['put'],
        allowedContentTypes: ['application/pdf'],
        maximumSizeInBytes: MAX_PDF_BYTES,
        validUntil: Date.now() + 3600000,
        ...auth(),
      });
      const { presignedUrl } = await presignUrl(token, {
        pathname,
        operation: 'put',
        access: 'private',
        allowedContentTypes: ['application/pdf'],
        maximumSizeInBytes: MAX_PDF_BYTES,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      return presignedUrl;
    },

    async read(pathname) {
      const { stream } = await open(pathname);

      const chunks = [];
      let size = 0;

      for await (const chunk of Readable.fromWeb(stream)) {
        size += chunk.length;

        if (size > MAX_PDF_BYTES) {
          throw fail(413, 'PDF must be 50 MB or smaller.');
        }

        chunks.push(chunk);
      }

      return Buffer.concat(chunks);
    },

    async send(res, file) {
      const result = await open(file.storageName);

      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, no-store',
        'Content-Disposition':
          `attachment; filename="notes.pdf"; filename*=UTF-8''` +
          encodeURIComponent(file.name).replace(/'/g, '%27'),
      });

      await pipeline(Readable.fromWeb(result.stream), res);
    },

    remove: pathname =>
      del(pathname, {
        ...auth(),
      }),
  };
}
