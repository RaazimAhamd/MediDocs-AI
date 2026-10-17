import test from 'node:test';
import assert from 'node:assert/strict';
import { rankChunks } from '../../src/services/retrieval.js';
import { normalize } from '../../src/utils/vector.js';

const rec = (documentId, chunkIndex, vector, extra = {}) => ({
  documentId,
  documentName: `${documentId}.txt`,
  page: null,
  chunkIndex,
  text: `text ${documentId}-${chunkIndex}`,
  vector: normalize(vector),
  ...extra,
});

const query = normalize([1, 0, 0]);

test('ranks by cosine similarity, best first', () => {
  const records = [rec('a', 0, [0, 1, 0]), rec('b', 0, [1, 0.1, 0]), rec('c', 0, [1, 1, 0])];
  const { passages, best } = rankChunks(query, records, { topK: 3, minSimilarity: 0 });
  assert.deepEqual(passages.map((p) => p.documentId), ['b', 'c', 'a']);
  assert.ok(best > 0.99);
});

test('limits results to topK', () => {
  const records = Array.from({ length: 10 }, (_, i) => rec('a', i, [1, i * 0.1, 0]));
  assert.equal(rankChunks(query, records, { topK: 4, minSimilarity: 0 }).passages.length, 4);
});

test('drops passages below the similarity threshold but still reports the best score', () => {
  const records = [rec('a', 0, [0, 1, 0]), rec('b', 0, [0.2, 1, 0])];
  const result = rankChunks(query, records, { topK: 3, minSimilarity: 0.5 });
  assert.equal(result.passages.length, 0);
  assert.ok(result.best > 0 && result.best < 0.5);
});

test('skips vectors with a different dimension (e.g. another embedding model)', () => {
  const records = [rec('a', 0, [1, 0]), rec('b', 0, [1, 0, 0])];
  const { passages } = rankChunks(query, records, { topK: 5, minSimilarity: 0 });
  assert.deepEqual(passages.map((p) => p.documentId), ['b']);
});

test('ties are broken deterministically', () => {
  const records = [rec('b', 1, [1, 0, 0]), rec('a', 2, [1, 0, 0]), rec('a', 1, [1, 0, 0])];
  const { passages } = rankChunks(query, records, { topK: 3, minSimilarity: 0 });
  assert.deepEqual(passages.map((p) => `${p.documentId}${p.chunkIndex}`), ['a1', 'a2', 'b1']);
});

test('empty record list returns no passages', () => {
  assert.deepEqual(rankChunks(query, [], { topK: 3, minSimilarity: 0 }), { best: 0, passages: [] });
});
