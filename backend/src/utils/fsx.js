import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function removeFile(file) {
  await fs.rm(file, { force: true });
}

/** Windows can briefly lock files (antivirus, indexer); retry transient rename errors. */
async function renameWithRetry(from, to, attempts = 5) {
  for (let i = 1; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const transient = ['EPERM', 'EBUSY', 'EACCES'].includes(err?.code);
      if (!transient || i >= attempts) throw err;
      await sleep(40 * i);
    }
  }
}

/**
 * Write a file without ever exposing a half-written version.
 * The temp file is created in the SAME directory, so rename() never crosses devices.
 * If rename still fails, fall back to copy + cleanup.
 */
export async function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, data);
  try {
    await renameWithRetry(tmp, file);
  } catch {
    try {
      await fs.copyFile(tmp, file);
    } finally {
      await removeFile(tmp);
    }
  }
}

/** Returns parsed JSON, or null if the file does not exist. Throws on invalid JSON. */
export async function readJsonIfExists(file) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
  return JSON.parse(raw);
}
