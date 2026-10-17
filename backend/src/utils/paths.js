import path from 'node:path';

/** Resolve `segments` under `baseDir`, throwing if the result would escape it. */
export function resolveInside(baseDir, ...segments) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...segments);
  const rel = path.relative(base, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes the allowed directory.');
  }
  return target;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Error('Invalid identifier.');
  return id;
}
