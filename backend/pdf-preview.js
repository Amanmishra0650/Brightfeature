import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'node:url';

export async function renderPreview(content) {
  const task = getDocument({ data: new Uint8Array(content), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)) });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, 2); i++) {
      const page = await doc.getPage(i);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(1000 / natural.width, 1500 / natural.height);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      pages.push(canvas.toBuffer('image/png'));
      page.cleanup();
    }
    return { pageCount: doc.numPages, pages };
  } catch (cause) {
    throw Object.assign(new Error('Unable to preview this PDF. Upload an unencrypted, valid PDF.', { cause }), { status: 400 });
  } finally { await task.destroy(); }
}
