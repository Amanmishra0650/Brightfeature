import { writeFile } from 'node:fs/promises';

// A small, dependency-free PDF containing the same illustrative preview as the site.
const lines = [
  'BRIGHT FUTURE NOTES', 'Illustrative sample - not a complete exam pack',
  '', 'CHAPTER 01 / QUICK REVISION', 'The Indian Constitution',
  '', 'The Constitution of India came into effect on 26 January 1950.',
  'It sets out the framework of government and fundamental rights.',
  '', 'Remember this', 'Adopted: 26 November 1949', 'Effective: 26 January 1950',
  '', 'Quick check', 'On which date is Republic Day celebrated?', 'Answer: 26 January',
  '', 'Demo content only. No full study pack or payment is included.',
  'This file is an illustrative sample for local development.',
];
const escape = value => value.replace(/[\\()]/g, '\\$&');
const stream = `BT /F1 13 Tf 50 785 Td 23 TL\n${lines.map((line, i) => `${i ? 'T* ' : ''}(${escape(line)}) Tj`).join('\n')}\nET`;
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
];
let pdf = '%PDF-1.4\n';
const offsets = [0];
for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; }
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile(new URL('../public/sample-notes.pdf', import.meta.url), pdf);
console.log('Created public/sample-notes.pdf');
