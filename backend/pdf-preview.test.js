import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { renderPreview } from './pdf-preview.js'

function fixture(pageCount) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] >>`,
  ]
  for (let i = 0; i < pageCount; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents ${4 + i * 2} 0 R >>`)
    const stream = `${i / pageCount} 0.2 0.5 rg 40 40 200 200 re f\n`
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`)
  }
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

test('renders only the first two actual pages as bounded PNGs', async () => {
  const result = await renderPreview(fixture(4))
  assert.equal(result.pageCount, 4)
  assert.equal(result.pages.length, 2)
  for (const page of result.pages) {
    assert.ok(Buffer.isBuffer(page))
    assert.deepEqual(page.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    assert.ok(page.readUInt32BE(16) <= 1000)
    assert.ok(page.readUInt32BE(20) <= 1500)
  }
  assert.notDeepEqual(result.pages[0], result.pages[1])
})

test('renders the existing sample PDF', async () => {
  const result = await renderPreview(await readFile(new URL('../public/sample-notes.pdf', import.meta.url)))
  assert.ok(result.pageCount >= 1)
  assert.equal(result.pages.length, Math.min(2, result.pageCount))
})

test('rejects invalid PDF data with an actionable client error', async () => {
  await assert.rejects(renderPreview(Buffer.from('not a PDF')), error => error.status === 400 && /PDF/.test(error.message))
})
