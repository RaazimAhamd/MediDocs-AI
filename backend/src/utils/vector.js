/** Cosine similarity of two equal-length numeric vectors. Returns 0 if either has zero length. */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new RangeError(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Returns a unit-length Float32Array copy. A zero vector is returned unchanged. */
export function normalize(vec) {
  const out = Float32Array.from(vec);
  let sum = 0;
  for (let i = 0; i < out.length; i++) sum += out[i] * out[i];
  const length = Math.sqrt(sum);
  if (length > 0) for (let i = 0; i < out.length; i++) out[i] /= length;
  return out;
}

export function encodeVector(vec) {
  const f32 = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString('base64');
}

export function decodeVector(base64) {
  const buf = Buffer.from(base64, 'base64');
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(copy);
}

export function isFiniteVector(vec) {
  return Array.isArray(vec) && vec.length > 0 && vec.every((n) => typeof n === 'number' && Number.isFinite(n));
}
