export type DocStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface ApiErrorBody {
  code: string;
  message: string;
}

export interface DocumentDto {
  id: string;
  name: string;
  extension: string;
  sizeBytes: number;
  uploadedAt: string;
  updatedAt: string;
  status: DocStatus;
  stage: string | null;
  progress: { done: number; total: number } | null;
  pageCount: number | null;
  chunkCount: number;
  characterCount: number;
  embedModel: string | null;
  error: ApiErrorBody | null;
}

export interface HealthDto {
  status: string;
  app: string;
  mode: string;
  time: string;
  uptimeSeconds: number;
  ollama: {
    reachable: boolean;
    ready: boolean;
    version?: string;
    chatModel?: { name: string; installed: boolean };
    embedModel?: { name: string; installed: boolean };
    missingModels?: string[];
    code?: string;
    message?: string;
  };
}

export interface ModelDto {
  name: string;
  sizeBytes: number;
  modifiedAt: string | null;
}

export interface ModelsResponse {
  defaultModel: string;
  embedModel: string;
  models: ModelDto[];
}

export interface SettingsDto {
  maxUploadMb: number;
  allowedExtensions: string[];
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  minSimilarity: number;
  defaultModel: string;
  embedModel: string;
}

export interface ChunkDto {
  index: number;
  page: number | null;
  text: string;
}

export interface SourceDto {
  ref: number;
  documentId: string;
  documentName: string;
  page: number | null;
  chunkIndex: number;
  score: number;
  text: string;
  cited: boolean;
}

export type AnswerReason =
  | 'OK'
  | 'NO_CITATIONS'
  | 'NO_DOCUMENTS'
  | 'LOW_SIMILARITY'
  | 'MODEL_INSUFFICIENT';

export interface AskResponse {
  answer: string;
  grounded: boolean;
  reason: AnswerReason;
  model: string;
  sources: SourceDto[];
  retrieval: { searchedChunks: number; topK: number; minSimilarity: number; bestScore: number };
  timings: { retrievalMs: number; generationMs: number };
  disclaimer: string;
}

export interface AskRequest {
  question: string;
  model?: string;
  documentIds?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status: 'done' | 'pending' | 'error';
  response?: Pick<AskResponse, 'grounded' | 'reason' | 'model' | 'sources' | 'timings' | 'disclaimer'>;
  errorCode?: string;
  errorMessage?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}
