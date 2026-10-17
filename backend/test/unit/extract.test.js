import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractPdf, extractText } from '../../src/services/extract.js';

const fixture = (name) => fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

test('PDF text is extracted per page with page numbers', async () => {
  const { pages, pageCount } = await extractPdf(fixture('sample-policy.pdf'));
  assert.equal(pageCount, 3);
  assert.deepEqual(pages.map((p) => p.page), [1, 2, 3]);
  assert.match(pages[0].text, /Scheduling appointments/);
  assert.match(pages[1].text, /at least 24 hours in advance/);
  assert.match(pages[2].text, /within 14 days/);
});

test('extracting the same buffer twice works (pdf.js must not detach the original)', async () => {
  const buf = fixture('sample-policy.pdf');
  await extractPdf(buf);
  const again = await extractPdf(buf);
  assert.equal(again.pageCount, 3);
});

test('malformed PDF -> 422 PDF_INVALID', async () => {
  await assert.rejects(extractPdf(fixture('malformed.pdf')), (e) => e.status === 422 && e.code === 'PDF_INVALID');
});

test('password-protected PDF -> 422 PDF_ENCRYPTED', async () => {
  await assert.rejects(extractPdf(fixture('encrypted.pdf')), (e) => e.status === 422 && e.code === 'PDF_ENCRYPTED');
});

test('PDF without a text layer (scanned) -> 422 PDF_NO_TEXT', async () => {
  await assert.rejects(extractPdf(fixture('no-text.pdf')), (e) => e.status === 422 && e.code === 'PDF_NO_TEXT');
});

test('page limit is enforced', async () => {
  await assert.rejects(extractPdf(fixture('sample-policy.pdf'), { maxPages: 2 }), (e) => e.code === 'PDF_TOO_MANY_PAGES');
});

test('TXT: UTF-8, BOM and CRLF are handled', () => {
  const { pages, pageCount } = extractText(Buffer.from('\uFEFFLine one\r\nLine two  \r\n\r\n\r\n\r\nLine three', 'utf8'));
  assert.equal(pageCount, null);
  assert.equal(pages[0].page, null);
  assert.equal(pages[0].text, 'Line one\nLine two\n\nLine three');
});

test('TXT: legacy Windows-1252 files fall back gracefully', () => {
  const buf = Buffer.from([0x43, 0x61, 0x66, 0xe9]); // "Café" in Windows-1252
  assert.equal(extractText(buf).pages[0].text, 'Café');
});

test('TXT: whitespace-only content -> 422 EMPTY_DOCUMENT', () => {
  assert.throws(() => extractText(Buffer.from('   \n  ')), (e) => e.code === 'EMPTY_DOCUMENT');
});
