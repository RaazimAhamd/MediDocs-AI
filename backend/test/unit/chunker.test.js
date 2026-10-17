import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkPages, splitText } from '../../src/services/chunker.js';

const sentence = 'The hospital offers outpatient appointments on weekdays. ';

test('empty or whitespace text yields no chunks', () => {
  assert.deepEqual(splitText(''), []);
  assert.deepEqual(splitText('   \n\n  '), []);
  assert.deepEqual(splitText(undefined), []);
});

test('short text stays in a single chunk', () => {
  assert.deepEqual(splitText('Hello world', { size: 100, overlap: 10 }), ['Hello world']);
});

test('chunks never exceed the configured size', () => {
  const text = sentence.repeat(80);
  const chunks = splitText(text, { size: 300, overlap: 50 });
  assert.ok(chunks.length > 5);
  for (const c of chunks) assert.ok(c.length <= 300, `chunk of ${c.length} chars`);
});

test('consecutive chunks overlap and nothing is lost', () => {
  const words = Array.from({ length: 400 }, (_, i) => `word${i}`);
  const text = words.join(' ');
  const chunks = splitText(text, { size: 200, overlap: 40 });
  for (let i = 1; i < chunks.length; i++) {
    const prevWords = chunks[i - 1].split(' ');
    const firstWord = chunks[i].split(' ')[0];
    assert.ok(prevWords.includes(firstWord), `chunk ${i} should start inside the previous chunk`);
  }
  const seen = new Set(chunks.join(' ').split(' '));
  for (const w of words) assert.ok(seen.has(w), `${w} missing`);
});

test('overlap of zero produces disjoint chunks', () => {
  const chunks = splitText('abcdefghij '.repeat(60), { size: 100, overlap: 0 });
  assert.ok(chunks.length > 1);
});

test('prefers paragraph boundaries when available', () => {
  const para = 'A'.repeat(30) + ' ' + 'b'.repeat(30) + '.';
  const text = [para, para, para, para].join('\n\n');
  const chunks = splitText(text, { size: 150, overlap: 0 });
  assert.ok(chunks.every((c) => !c.endsWith(' ')));
  assert.ok(chunks[0].split('\n\n').length >= 2);
});

test('text with no spaces still terminates and respects the size', () => {
  const chunks = splitText('x'.repeat(1000), { size: 200, overlap: 50 });
  assert.ok(chunks.length >= 5);
  for (const c of chunks) assert.ok(c.length <= 200);
});

test('invalid options are rejected', () => {
  assert.throws(() => splitText('text', { size: 10, overlap: 0 }), RangeError);
  assert.throws(() => splitText('text', { size: 200, overlap: 150 }), RangeError);
  assert.throws(() => splitText('text', { size: 200, overlap: -1 }), RangeError);
});

test('chunkPages keeps exact page numbers and sequential indexes', () => {
  const pages = [
    { page: 1, text: sentence.repeat(30) },
    { page: 2, text: 'Short second page.' },
    { page: 3, text: sentence.repeat(30) },
  ];
  const chunks = chunkPages(pages, { size: 300, overlap: 30 });
  assert.deepEqual(chunks.map((c) => c.index), chunks.map((_, i) => i));
  assert.ok(chunks.filter((c) => c.page === 1).length > 1);
  assert.equal(chunks.filter((c) => c.page === 2).length, 1);
  assert.ok(chunks.filter((c) => c.page === 3).length > 1);
  const pageOrder = chunks.map((c) => c.page);
  assert.deepEqual(pageOrder, [...pageOrder].sort((a, b) => a - b));
});

test('plain text files use null page numbers', () => {
  const chunks = chunkPages([{ page: null, text: 'Just some text.' }], { size: 200, overlap: 20 });
  assert.equal(chunks[0].page, null);
});
