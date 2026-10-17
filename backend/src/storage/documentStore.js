import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, readJsonIfExists, removeFile, writeFileAtomic } from '../utils/fsx.js';
import { assertUuid, resolveInside } from '../utils/paths.js';
import { decodeVector, encodeVector } from '../utils/vector.js';

const DB_VERSION = 1;

/**
 * File-backed store (no native modules, works on Windows without build tools).
 *   data/db/documents.json        document metadata
 *   data/db/chunks/<id>.json      chunk text + base64 Float32 embeddings for one document
 *   data/uploads/<id>.<ext>       original uploads (random names; never served publicly)
 * Embeddings are loaded into memory on first use; cosine similarity runs in-process.
 */
export class DocumentStore {
  #docs = new Map();
  #chunkCache = new Map();
  #writeChain = Promise.resolve();

  constructor(dataDir, logger = console) {
    this.dataDir = dataDir;
    this.logger = logger;
    this.dbDir = path.join(dataDir, 'db');
    this.chunksDir = path.join(this.dbDir, 'chunks');
    this.uploadsDir = path.join(dataDir, 'uploads');
    this.dbFile = path.join(this.dbDir, 'documents.json');
  }

  async init() {
    await ensureDir(this.chunksDir);
    await ensureDir(this.uploadsDir);
    try {
      const data = await readJsonIfExists(this.dbFile);
      for (const doc of data?.documents ?? []) this.#docs.set(doc.id, doc);
    } catch (err) {
      const backup = `${this.dbFile}.corrupt-${Date.now()}`;
      this.logger.error(`[store] documents.json is unreadable (${err.message}). Moving it to ${backup} and starting empty.`);
      await fs.rename(this.dbFile, backup).catch(() => {});
    }
  }

  list() {
    return [...this.#docs.values()]
      .map((d) => ({ ...d }))
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  get(id) {
    const doc = this.#docs.get(id);
    return doc ? { ...doc } : undefined;
  }

  has(id) {
    return this.#docs.has(id);
  }

  async insert(doc) {
    this.#docs.set(doc.id, { ...doc });
    await this.#persist();
  }

  async update(id, patch) {
    const doc = this.#docs.get(id);
    if (!doc) return undefined;
    Object.assign(doc, patch, { updatedAt: new Date().toISOString() });
    await this.#persist();
    return { ...doc };
  }

  /** In-memory only (e.g. embedding progress); not written to disk. */
  updateTransient(id, patch) {
    const doc = this.#docs.get(id);
    if (doc) Object.assign(doc, patch);
  }

  uploadPath(doc) {
    assertUuid(doc.id);
    return resolveInside(this.uploadsDir, `${doc.id}${doc.extension}`);
  }

  chunkFile(id) {
    assertUuid(id);
    return resolveInside(this.chunksDir, `${id}.json`);
  }

  async saveChunks(id, { embedModel, dim, chunks }) {
    const payload = {
      version: DB_VERSION,
      docId: id,
      embedModel,
      dim,
      chunks: chunks.map((c) => ({
        index: c.index,
        page: c.page,
        text: c.text,
        embedding: encodeVector(c.vector),
      })),
    };
    await writeFileAtomic(this.chunkFile(id), JSON.stringify(payload));
    this.#chunkCache.set(id, {
      embedModel,
      dim,
      chunks: chunks.map((c) => ({ index: c.index, page: c.page, text: c.text, vector: c.vector })),
    });
  }

  /** Returns { embedModel, dim, chunks: [{index, page, text, vector}] } or null. */
  async loadChunks(id) {
    if (this.#chunkCache.has(id)) return this.#chunkCache.get(id);
    let data;
    try {
      data = await readJsonIfExists(this.chunkFile(id));
    } catch (err) {
      this.logger.error(`[store] chunk file for ${id} is unreadable: ${err.message}`);
      return null;
    }
    if (!data) return null;
    const loaded = {
      embedModel: data.embedModel,
      dim: data.dim,
      chunks: data.chunks.map((c) => ({
        index: c.index,
        page: c.page,
        text: c.text,
        vector: decodeVector(c.embedding),
      })),
    };
    this.#chunkCache.set(id, loaded);
    return loaded;
  }

  async remove(id) {
    const doc = this.#docs.get(id);
    if (!doc) return undefined;
    this.#docs.delete(id);
    this.#chunkCache.delete(id);
    await this.#persist();
    await removeFile(this.chunkFile(id));
    await removeFile(this.uploadPath(doc));
    return { ...doc };
  }

  #persist() {
    const snapshot = JSON.stringify({ version: DB_VERSION, documents: [...this.#docs.values()] }, null, 2);
    const run = () => writeFileAtomic(this.dbFile, snapshot);
    const next = this.#writeChain.then(run, run);
    this.#writeChain = next.catch(() => {});
    return next;
  }
}
