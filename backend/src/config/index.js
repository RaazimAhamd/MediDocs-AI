import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const backendRoot = fileURLToPath(new URL('../..', import.meta.url));

const bool = z
  .enum(['true', 'false'])
  .default('true')
  .transform((v) => v === 'true');

const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CORS_ORIGIN: z.string().default('http://localhost:4200,http://127.0.0.1:4200'),
    OLLAMA_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
    OLLAMA_CHAT_MODEL: z.string().min(1).default('gemma3:latest'),
    OLLAMA_EMBED_MODEL: z.string().min(1).default('nomic-embed-text:latest'),
    ALLOWED_CHAT_MODELS: z.string().default('gemma3,llama3'),
    OLLAMA_EMBED_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(120000),
    OLLAMA_CHAT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(290000).default(240000),
    DATA_DIR: z.string().min(1).default('./data'),
    MAX_UPLOAD_MB: z.coerce.number().min(0.01).max(50).default(10),
    MAX_PDF_PAGES: z.coerce.number().int().min(1).max(2000).default(300),
    CHUNK_SIZE: z.coerce.number().int().min(200).max(4000).default(1000),
    CHUNK_OVERLAP: z.coerce.number().int().min(0).max(2000).default(150),
    TOP_K: z.coerce.number().int().min(1).max(10).default(4),
    MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.3),
    EMBED_BATCH_SIZE: z.coerce.number().int().min(1).max(64).default(8),
    CHAT_NUM_CTX: z.coerce.number().int().min(1024).max(32768).default(4096),
    RATE_LIMIT_API_PER_MINUTE: z.coerce.number().int().min(5).max(10000).default(300),
    RATE_LIMIT_ASK_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(12),
    RATE_LIMIT_UPLOAD_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(20),
    FRONTEND_DIST: z.string().default('../frontend/dist/medidocs/browser'),
    LOG_REQUESTS: bool,
  })
  .refine((e) => e.CHUNK_OVERLAP <= e.CHUNK_SIZE / 2, {
    message: 'CHUNK_OVERLAP must be at most half of CHUNK_SIZE',
    path: ['CHUNK_OVERLAP'],
  });

const csv = (value) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export function loadConfig(env = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || 'config'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration (check backend/.env):\n${problems}`);
  }
  const e = parsed.data;

  const corsOrigins = csv(e.CORS_ORIGIN);
  for (const origin of corsOrigins) {
    try {
      new URL(origin);
    } catch {
      throw new Error(
        `Invalid environment configuration (check backend/.env):\n  - CORS_ORIGIN: "${origin}" is not a valid URL`,
      );
    }
  }

  return Object.freeze({
    port: e.PORT,
    corsOrigins,
    ollama: Object.freeze({
      baseUrl: e.OLLAMA_BASE_URL.replace(/\/+$/, ''),
      chatModel: e.OLLAMA_CHAT_MODEL,
      embedModel: e.OLLAMA_EMBED_MODEL,
      embedTimeoutMs: e.OLLAMA_EMBED_TIMEOUT_MS,
      chatTimeoutMs: e.OLLAMA_CHAT_TIMEOUT_MS,
      allowedChatModels: csv(e.ALLOWED_CHAT_MODELS),
      numCtx: e.CHAT_NUM_CTX,
    }),
    dataDir: path.resolve(backendRoot, e.DATA_DIR),
    frontendDist: path.resolve(backendRoot, e.FRONTEND_DIST),
    maxUploadBytes: Math.floor(e.MAX_UPLOAD_MB * 1024 * 1024),
    maxPdfPages: e.MAX_PDF_PAGES,
    rag: Object.freeze({
      chunkSize: e.CHUNK_SIZE,
      chunkOverlap: e.CHUNK_OVERLAP,
      topK: e.TOP_K,
      minSimilarity: e.MIN_SIMILARITY,
      embedBatchSize: e.EMBED_BATCH_SIZE,
    }),
    rateLimits: Object.freeze({
      api: e.RATE_LIMIT_API_PER_MINUTE,
      ask: e.RATE_LIMIT_ASK_PER_MINUTE,
      upload: e.RATE_LIMIT_UPLOAD_PER_MINUTE,
    }),
    logRequests: e.LOG_REQUESTS,
  });
}
