import test from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, decodeVector, encodeVector, normalize } from '../../src/utils/vector.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('cosine similarity of identical vectors is 1', () => close(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1));
test('cosine similarity of orthogonal vectors is 0', () => close(cosineSimilarity([1, 0], [0, 1]), 0));
test('cosine similarity of opposite vectors is -1', () => close(cosineSimilarity([1, 2], [-1, -2]), -1));
test('cosine similarity ignores magnitude', () => close(cosineSimilarity([1, 1], [10, 10]), 1));
test('zero vectors score 0 instead of NaN', () => assert.equal(cosineSimilarity([0, 0], [1, 2]), 0));
test('length mismatch throws', () => assert.throws(() => cosineSimilarity([1], [1, 2]), RangeError));

test('normalize returns a unit vector without mutating the input', () => {
  const input = [3, 4];
  const out = normalize(input);
  close(out[0], 0.6);
  close(out[1], 0.8);
  assert.deepEqual(input, [3, 4]);
  assert.deepEqual([...normalize([0, 0])], [0, 0]);
});

test('encode/decode round-trips Float32 vectors', () => {
  const v = Float32Array.from([0.25, -1.5, 3.125, 0]);
  const decoded = decodeVector(encodeVector(v));
  assert.deepEqual([...decoded], [...v]);
});
