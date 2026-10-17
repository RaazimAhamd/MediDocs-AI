import { AppError } from '../errors.js';

const MIN_PDF_CHARS = 20;

function cleanText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractText(buffer) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // Not valid UTF-8 (typical for old Windows files): fall back to Windows-1252.
    text = new TextDecoder('windows-1252').decode(buffer);
  }
  text = cleanText(text.replace(/^\uFEFF/, ''));
  if (!text) throw AppError.unprocessable('The text file contains no readable text.', 'EMPTY_DOCUMENT');
  return { pages: [{ page: null, text }], pageCount: null };
}

/** Rebuild readable lines from pdf.js text items using their positions. */
export function itemsToText(items) {
  const lines = [];
  let current = null;
  let lastY = null;
  let lineHeight = 12;

  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    const height = item.height || lineHeight;

    const newLine = lastY === null || Math.abs(y - lastY) > Math.max(2, height * 0.5);
    if (newLine) {
      if (current) {
        const gap = lastY !== null ? Math.abs(lastY - y) : 0;
        lines.push(current.text);
        if (gap > lineHeight * 1.8) lines.push('');
      }
      current = { text: item.str, endX: x + (item.width || 0) };
    } else {
      const needsSpace = x - current.endX > 1 && !/\s$/.test(current.text) && !/^\s/.test(item.str);
      current.text += (needsSpace ? ' ' : '') + item.str;
      current.endX = x + (item.width || 0);
    }
    lastY = y;
    lineHeight = height;
    if (item.hasEOL && current) {
      lines.push(current.text);
      current = null;
      lastY = null;
    }
  }
  if (current) lines.push(current.text);
  return lines.join('\n');
}

export async function extractPdf(buffer, { maxPages = 300 } = {}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdf.js takes ownership of the array it is given, so always pass a copy.
  const data = new Uint8Array(buffer.byteLength);
  data.set(buffer);

  const task = pdfjs.getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  });

  let pdf;
  try {
    pdf = await task.promise;
  } catch (err) {
    if (err?.name === 'PasswordException') {
      throw AppError.unprocessable('This PDF is password-protected. Remove the password and upload it again.', 'PDF_ENCRYPTED');
    }
    throw AppError.unprocessable('This PDF could not be read. It may be damaged or malformed.', 'PDF_INVALID');
  }

  try {
    if (pdf.numPages > maxPages) {
      throw AppError.unprocessable(`This PDF has ${pdf.numPages} pages; the limit is ${maxPages}.`, 'PDF_TOO_MANY_PAGES');
    }
    const pages = [];
    let totalChars = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = cleanText(itemsToText(content.items));
      page.cleanup();
      totalChars += text.length;
      if (text) pages.push({ page: n, text });
    }
    if (totalChars < MIN_PDF_CHARS) {
      throw AppError.unprocessable(
        'No text could be extracted. This looks like a scanned PDF; OCR is not supported in this demo.',
        'PDF_NO_TEXT',
      );
    }
    return { pages, pageCount: pdf.numPages };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.unprocessable('This PDF could not be read. It may be damaged or malformed.', 'PDF_INVALID');
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

export async function extractDocument({ buffer, extension, maxPages }) {
  if (extension === '.pdf') return extractPdf(buffer, { maxPages });
  if (extension === '.txt') return extractText(buffer);
  throw AppError.unsupportedMediaType('Unsupported file type.', 'UNSUPPORTED_EXTENSION');
}
