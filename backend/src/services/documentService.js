import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AppError, publicErrorInfo } from '../errors.js';
import { TaskQueue } from '../utils/queue.js';
import { validateUploadContent, validateUploadMeta } from '../utils/validation.js';
import { normalize } from '../utils/vector.js';
import { chunkPages } from './chunker.js';
import { extractDocument } from './extract.js';
import { prepareDocumentInputs } from './embeddings.js';

/** Fields that are safe to send to the browser (never the storage path). */
export function toPublicDocument(doc) {
  return {
    id: doc.id,
    name: doc.originalName,
    extension: doc.extension,
    sizeBytes: doc.sizeBytes,
    uploadedAt: doc.uploadedAt,
    updatedAt: doc.updatedAt,
    status: doc.status,
    stage: doc.stage ?? null,
    progress: doc.progress ?? null,
    pageCount: doc.pageCount ?? null,
    chunkCount: doc.chunkCount ?? 0,
    characterCount: doc.characterCount ?? 0,
    embedModel: doc.embedModel ?? null,
    error: doc.error ?? null,
  };
}

export class DocumentService {
  constructor({ config, store, ollama, logger = console }) {
    this.config = config;
    this.store = store;
    this.ollama = ollama;
    this.logger = logger;
    // One document at a time keeps CPU/RAM usage low on small machines.
    this.queue = new TaskQueue(1);
  }

  list() {
    return this.store.list().map(toPublicDocument);
  }

  #require(id) {
    const doc = this.store.get(id);
    if (!doc) throw AppError.notFound('Document not found.', 'DOCUMENT_NOT_FOUND');
    return doc;
  }

  get(id) {
    return toPublicDocument(this.#require(id));
  }

  getStatus(id) {
    const d = toPublicDocument(this.#require(id));
    return {
      id: d.id,
      status: d.status,
      stage: d.stage,
      progress: d.progress,
      chunkCount: d.chunkCount,
      pageCount: d.pageCount,
      error: d.error,
    };
  }

  async createFromUpload(file) {
    if (!file) throw AppError.badRequest('No file was uploaded. Send a PDF or TXT file in the "file" field.', undefined, 'NO_FILE');
    const { extension, displayName } = validateUploadMeta({ originalName: file.originalname, mimeType: file.mimetype });
    validateUploadContent({ buffer: file.buffer, extension });

    const now = new Date().toISOString();
    const doc = {
      id: randomUUID(),
      originalName: displayName,
      extension,
      sizeBytes: file.buffer.length,
      uploadedAt: now,
      updatedAt: now,
      status: 'queued',
      stage: 'queued',
      progress: null,
      pageCount: null,
      chunkCount: 0,
      characterCount: 0,
      embedModel: null,
      error: null,
    };

    // The random UUID name means user input never influences the path. 'wx' refuses to overwrite.
    await fs.writeFile(this.store.uploadPath(doc), file.buffer, { flag: 'wx' });
    await this.store.insert(doc);
    this.enqueue(doc.id);
    return toPublicDocument(doc);
  }

  enqueue(id) {
    this.queue.add(() => this.#process(id)).catch((err) => {
      this.logger.error(`[documents] unexpected failure for ${id}:`, err);
    });
  }

  async retry(id) {
    const doc = this.#require(id);
    if (doc.status !== 'failed') {
      throw AppError.conflict('Only documents whose processing failed can be retried.', 'NOT_RETRYABLE');
    }
    const updated = await this.store.update(id, { status: 'queued', stage: 'queued', progress: null, error: null });
    this.enqueue(id);
    return toPublicDocument(updated);
  }

  async remove(id) {
    this.#require(id);
    await this.store.remove(id);
    this.logger.log(`[documents] deleted ${id}`);
  }

  /** Re-queue documents that were mid-processing when the server last stopped. */
  async recover() {
    for (const doc of this.store.list()) {
      if (doc.status === 'queued' || doc.status === 'processing') {
        await this.store.update(doc.id, { status: 'queued', stage: 'queued', progress: null });
        this.enqueue(doc.id);
      }
    }
  }

  async listChunks(id, { offset, limit }) {
    this.#require(id);
    const data = await this.store.loadChunks(id);
    const all = data?.chunks ?? [];
    return {
      total: all.length,
      chunks: all.slice(offset, offset + limit).map((c) => ({ index: c.index, page: c.page, text: c.text })),
    };
  }

  async getChunk(id, index) {
    const doc = this.#require(id);
    const data = await this.store.loadChunks(id);
    const chunk = data?.chunks.find((c) => c.index === index);
    if (!chunk) throw AppError.notFound('Passage not found.', 'CHUNK_NOT_FOUND');
    return {
      documentId: doc.id,
      documentName: doc.originalName,
      index: chunk.index,
      page: chunk.page,
      text: chunk.text,
      totalChunks: data.chunks.length,
    };
  }

  async whenIdle() {
    await this.queue.idle();
  }

  async #process(id) {
    const doc = this.store.get(id);
    if (!doc) return;
    const embedModel = this.config.ollama.embedModel;
    const started = Date.now();

    try {
      await this.store.update(id, { status: 'processing', stage: 'extracting', progress: null, error: null });

      const buffer = await fs.readFile(this.store.uploadPath(doc));
      const { pages, pageCount } = await extractDocument({
        buffer,
        extension: doc.extension,
        maxPages: this.config.maxPdfPages,
      });
      if (!this.store.has(id)) return;

      const chunks = chunkPages(pages, {
        size: this.config.rag.chunkSize,
        overlap: this.config.rag.chunkOverlap,
      });
      if (chunks.length === 0) {
        throw AppError.unprocessable('No readable text was found in this document.', 'EMPTY_DOCUMENT');
      }
      const characterCount = chunks.reduce((n, c) => n + c.text.length, 0);

      this.store.updateTransient(id, { stage: 'embedding', progress: { done: 0, total: chunks.length }, pageCount });

      const batchSize = this.config.rag.embedBatchSize;
      for (let i = 0; i < chunks.length; i += batchSize) {
        if (!this.store.has(id)) return; // deleted while processing
        const slice = chunks.slice(i, i + batchSize);
        const inputs = prepareDocumentInputs(embedModel, slice.map((c) => c.text));
        const vectors = await this.ollama.embed(embedModel, inputs);
        slice.forEach((c, k) => {
          c.vector = normalize(vectors[k]);
        });
        this.store.updateTransient(id, { progress: { done: Math.min(i + batchSize, chunks.length), total: chunks.length } });
      }

      const dim = chunks[0].vector.length;
      if (!chunks.every((c) => c.vector.length === dim)) {
        throw AppError.badGateway('Ollama returned embeddings of inconsistent size.');
      }
      if (!this.store.has(id)) return;

      await this.store.saveChunks(id, { embedModel, dim, chunks });
      if (!this.store.has(id)) {
        await this.store.remove(id).catch(() => {});
        return;
      }
      await this.store.update(id, {
        status: 'ready',
        stage: 'ready',
        progress: null,
        pageCount,
        chunkCount: chunks.length,
        characterCount,
        embedModel,
        error: null,
      });
      this.logger.log(`[documents] ${id} ready: ${chunks.length} chunks in ${Date.now() - started} ms`);
    } catch (err) {
      if (!this.store.has(id)) return;
      if (!(err instanceof AppError)) this.logger.error(`[documents] processing ${id} failed:`, err);
      else this.logger.warn(`[documents] processing ${id} failed: ${err.code}`);
      await this.store
        .update(id, { status: 'failed', stage: 'failed', progress: null, error: publicErrorInfo(err) })
        .catch(() => {});
    }
  }
}
