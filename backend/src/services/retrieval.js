import { cosineSimilarity, normalize } from '../utils/vector.js';
import { normalizeModelName } from '../utils/text.js';
import { prepareQueryInput } from './embeddings.js';

/**
 * Score every record against the query vector, keep the `topK` best, and drop those below `minSimilarity`.
 * `best` is the highest score seen (useful to explain "not enough information" answers).
 */
export function rankChunks(queryVector, records, { topK, minSimilarity }) {
  const scored = [];
  for (const record of records) {
    if (record.vector.length !== queryVector.length) continue; // different embedding model/size
    scored.push({ ...record, score: cosineSimilarity(queryVector, record.vector) });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score || a.documentId.localeCompare(b.documentId) || a.chunkIndex - b.chunkIndex,
  );
  const top = scored.slice(0, topK);
  return {
    best: top[0]?.score ?? 0,
    passages: top.filter((p) => p.score >= minSimilarity),
  };
}

export class RetrievalService {
  constructor({ config, store, ollama }) {
    this.config = config;
    this.store = store;
    this.ollama = ollama;
  }

  /** Gather every chunk from ready documents that were embedded with the current embedding model. */
  async #collect(documentIds) {
    const wantedModel = normalizeModelName(this.config.ollama.embedModel);
    const filter = documentIds?.length ? new Set(documentIds) : null;
    const records = [];
    let skippedDocuments = 0;

    for (const doc of this.store.list()) {
      if (doc.status !== 'ready') continue;
      if (filter && !filter.has(doc.id)) continue;
      const data = await this.store.loadChunks(doc.id);
      if (!data || normalizeModelName(data.embedModel) !== wantedModel) {
        skippedDocuments++;
        continue;
      }
      for (const c of data.chunks) {
        records.push({
          documentId: doc.id,
          documentName: doc.originalName,
          page: c.page,
          chunkIndex: c.index,
          text: c.text,
          vector: c.vector,
        });
      }
    }
    return { records, skippedDocuments };
  }

  async retrieve(question, { documentIds, signal } = {}) {
    const { records, skippedDocuments } = await this.#collect(documentIds);
    const { topK, minSimilarity } = this.config.rag;
    if (records.length === 0) {
      return { passages: [], bestScore: 0, searchedChunks: 0, skippedDocuments, topK, minSimilarity };
    }
    const [raw] = await this.ollama.embed(
      this.config.ollama.embedModel,
      [prepareQueryInput(this.config.ollama.embedModel, question)],
      { signal },
    );
    const { best, passages } = rankChunks(normalize(raw), records, { topK, minSimilarity });
    return { passages, bestScore: best, searchedChunks: records.length, skippedDocuments, topK, minSimilarity };
  }
}
