import { DocumentStore } from '../storage/documentStore.js';
import { DocumentService } from './documentService.js';
import { RetrievalService } from './retrieval.js';
import { RagService } from './rag.js';

/** Wires services together. Passing a fake `ollama` makes the whole stack testable offline. */
export async function createContainer({ config, ollama, logger = console, recover = false }) {
  const store = new DocumentStore(config.dataDir, logger);
  await store.init();
  const documents = new DocumentService({ config, store, ollama, logger });
  const retrieval = new RetrievalService({ config, store, ollama });
  const rag = new RagService({ config, ollama, retrieval });
  if (recover) await documents.recover();
  return { config, ollama, store, documents, retrieval, rag };
}
