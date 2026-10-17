import path from 'node:path';

/** Browsers send UTF-8 filenames but multer decodes them as latin1; undo that when it round-trips. */
export function fixFilenameEncoding(name) {
  if (/[\u00c0-\u00ff]/.test(name)) {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (!decoded.includes('\ufffd')) return decoded;
  }
  return name;
}

/** Produce a safe, human-readable display name. The stored file name is never derived from this. */
export function sanitizeDisplayName(raw) {
  let name = fixFilenameEncoding(String(raw ?? ''));
  name = name.split(/[\\/]/).pop() ?? '';
  name = name
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (name.length > 120) {
    const ext = path.extname(name).slice(0, 10);
    name = name.slice(0, 120 - ext.length) + ext;
  }
  return name || 'document';
}

/** Defuse text that imitates the prompt's own delimiters (e.g. "</passage>" or "<system>"). */
export function neutralizePromptDelimiters(text) {
  return String(text).replace(/<\s*(\/?)\s*(passage|system|assistant|user)\b/gi, '‹$1$2');
}

export function normalizeModelName(name) {
  const n = String(name).trim().toLowerCase();
  return n.includes(':') ? n : `${n}:latest`;
}
