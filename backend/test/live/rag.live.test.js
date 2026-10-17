/**
 * LIVE tests: need a running Ollama with the models from backend/.env installed.
 * They are skipped automatically when Ollama or a model is unavailable.
 *   npm run test:live
 * Retrieval is checked strictly; LLM wording is only checked loosely because model output varies.
 */
import 'dotenv/config';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { loadConfig } from '../../src/config/index.js';
import { OllamaClient, isInstalled } from '../../src/services/ollama.js';
import { SAMPLE_DIR, evaluate, loadExpected, mimeFor } from '../../scripts/lib/expected.js';
import { buildTestApp, waitFor } from '../helpers/app.js';

const config = loadConfig({ ...process.env, LOG_REQUESTS: 'false' });
const ollama = new OllamaClient({
  baseUrl: config.ollama.baseUrl,
  embedTimeoutMs: config.ollama.embedTimeoutMs,
  chatTimeoutMs: config.ollama.chatTimeoutMs,
});

let skipReason = null;
try {
  const models = await ollama.listModels();
  const missing = [config.ollama.embedModel, config.ollama.chatModel].filter((m) => !isInstalled(models, m));
  if (missing.length) skipReason = `models not installed: ${missing.join(', ')}`;
} catch {
  skipReason = `Ollama is not reachable at ${config.ollama.baseUrl}`;
}

const expected = loadExpected();
let ctx;

before(async () => {
  if (skipReason) return;
  ctx = await buildTestApp({
    ollama,
    env: {
      OLLAMA_CHAT_MODEL: config.ollama.chatModel,
      OLLAMA_EMBED_MODEL: config.ollama.embedModel,
      MIN_SIMILARITY: String(config.rag.minSimilarity),
      RATE_LIMIT_ASK_PER_MINUTE: '1000',
    },
  });
  for (const rel of expected.documents) {
    const res = await request(ctx.app)
      .post('/api/documents')
      .attach('file', await fs.readFile(path.join(SAMPLE_DIR, rel)), { filename: path.basename(rel), contentType: mimeFor(rel) });
    assert.equal(res.status, 202);
    await waitFor(
      async () => {
        const s = (await request(ctx.app).get(`/api/documents/${res.body.document.id}/status`)).body;
        assert.notEqual(s.status, 'failed', JSON.stringify(s.error));
        return s.status === 'ready';
      },
      { timeoutMs: 600000, intervalMs: 500 },
    );
  }
});

after(async () => {
  if (ctx) await ctx.cleanup();
});

for (const q of expected.questions) {
  test(`live ${q.id}: ${q.question}`, { skip: skipReason ?? false, timeout: 400000 }, async () => {
    const res = await request(ctx.app).post('/api/chat/ask').send({ question: q.question });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { hard, soft } = evaluate(q, res.body);
    if (soft.length) console.warn(`  (soft) ${q.id}: ${soft.join('; ')}`);
    assert.deepEqual(hard, [], `answer was: ${res.body.answer}`);
  });
}
