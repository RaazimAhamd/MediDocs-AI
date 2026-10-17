/**
 * Splits text into overlapping chunks of at most `size` characters.
 * Breaks prefer paragraph > sentence > line > word boundaries so passages stay readable.
 * `overlap` characters from the end of one chunk are repeated at the start of the next
 * (aligned to a word boundary) so facts that straddle a boundary are still retrievable.
 */
export function splitText(text, { size = 1000, overlap = 150 } = {}) {
  if (!Number.isInteger(size) || size < 50) throw new RangeError('size must be an integer >= 50');
  if (!Number.isInteger(overlap) || overlap < 0 || overlap > size / 2) {
    throw new RangeError('overlap must be an integer between 0 and size / 2');
  }

  const t = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!t) return [];
  if (t.length <= size) return [t];

  const minLen = Math.floor(size / 2);
  const chunks = [];
  let start = 0;

  while (start < t.length) {
    let end = Math.min(start + size, t.length);

    if (end < t.length) {
      const window = t.slice(start + minLen, end);
      const candidates = [
        window.lastIndexOf('\n\n'),
        Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! ')),
        window.lastIndexOf('\n'),
        window.lastIndexOf(' '),
      ];
      const best = candidates.find((i) => i >= 0);
      if (best !== undefined) end = start + minLen + best + 1;
    }

    const piece = t.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= t.length) break;

    let next = end - overlap;
    if (next <= start) next = end;
    // Start the overlap at a word boundary rather than mid-word.
    if (next > start && !/\s/.test(t[next - 1]) && !/\s/.test(t[next])) {
      const space = t.slice(next, end).search(/\s/);
      if (space >= 0) next += space + 1;
    }
    start = next;
  }
  return chunks;
}

/**
 * Chunk page-structured text. Chunks never span pages so every chunk has one exact page number
 * (page is null for plain-text files). `index` is a stable 0-based position within the document.
 */
export function chunkPages(pages, options) {
  const chunks = [];
  for (const { page, text } of pages) {
    for (const piece of splitText(text, options)) {
      chunks.push({ index: chunks.length, page: page ?? null, text: piece });
    }
  }
  return chunks;
}
