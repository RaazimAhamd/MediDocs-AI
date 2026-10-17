/**
 * TEST-ONLY stand-in for the Ollama HTTP API. It is never used by the application.
 * It lets the real OllamaClient, upload pipeline, retrieval and RAG code run end-to-end
 * in CI without a GPU or downloaded models:
 *   - /api/embed returns deterministic hashed bag-of-words vectors (lexical, not semantic)
 *   - /api/chat answers extractively from the first matching passage, or returns INSUFFICIENT_INFORMATION
 * Real model quality can only be judged with a real Ollama (see test/live and `npm run smoke`).
 */
import http from 'node:http';

const DIM = 512;
const STOP = new Set(
  'a an the and or of to in on at for with by is are was were be been it its this that these those do does did how what when where which who whom can may must will would should i we you they he she there their our your as from if not no any all about'.split(' '),
);

function words(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => !STOP.has(w))
    .map((w) => (w.length > 3 ? w.replace(/(ing|ed|es|s)$/, '') : w));
}

function hash(word) {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % DIM;
}

export function embedText(text) {
  const vec = new Array(DIM).fill(0);
  for (const w of words(text.replace(/^search_(document|query):\s*/, ''))) vec[hash(w)] += 1;
  return vec;
}

function parsePrompt(content) {
  const passages = [...content.matchAll(/<passage id="(\d+)"[^>]*>\n([\s\S]*?)\n<\/passage>/g)].map((m) => ({
    id: Number(m[1]),
    text: m[2],
  }));
  const question = (content.match(/Question: ([^\n]*)/) ?? [])[1] ?? '';
  return { passages, question };
}

export function mockAnswer(content) {
  const { passages, question } = parsePrompt(content);
  const q = new Set(words(question));
  let best = null;
  for (const p of passages) {
    for (const sentence of p.text.split(/(?<=[.!?])\s+/)) {
      const overlap = words(sentence).filter((w) => q.has(w)).length;
      if (overlap > (best?.overlap ?? 0)) best = { overlap, sentence: sentence.trim(), id: p.id };
    }
  }
  if (!best || best.overlap < 2) return 'INSUFFICIENT_INFORMATION';
  return `${best.sentence} [${best.id}]`;
}

export async function startMockOllama(options = {}) {
  const state = {
    version: '0.0.0-mock',
    models: options.models ?? ['gemma3:latest', 'llama3:latest', 'nomic-embed-text:latest'],
    requests: [],
    chatDelayMs: 0,
    chatReply: null, // optional (userContent) => string
    legacyEmbeddingsOnly: false,
  };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    state.requests.push({ method: req.method, url: req.url, body });

    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const hasModel = (name) =>
      state.models.some((m) => m === name || m.split(':')[0] === name || (!name.includes(':') && m === `${name}:latest`));

    if (req.url === '/api/version') return send(200, { version: state.version });
    if (req.url === '/api/tags') {
      return send(200, { models: state.models.map((name) => ({ name, size: 1000, modified_at: '2025-01-01T00:00:00Z' })) });
    }
    if (req.url === '/api/embed' && req.method === 'POST') {
      if (state.legacyEmbeddingsOnly) return send(404, {});
      if (!hasModel(body.model)) return send(404, { error: `model "${body.model}" not found, try pulling it first` });
      return send(200, { model: body.model, embeddings: body.input.map(embedText) });
    }
    if (req.url === '/api/embeddings' && req.method === 'POST') {
      if (!hasModel(body.model)) return send(404, { error: `model "${body.model}" not found, try pulling it first` });
      return send(200, { embedding: embedText(body.prompt) });
    }
    if (req.url === '/api/chat' && req.method === 'POST') {
      if (!hasModel(body.model)) return send(404, { error: `model "${body.model}" not found, try pulling it first` });
      if (state.chatDelayMs) await new Promise((r) => setTimeout(r, state.chatDelayMs));
      const user = body.messages.at(-1).content;
      const reply = state.chatReply ? state.chatReply(user) : mockAnswer(user);
      return send(200, { model: body.model, message: { role: 'assistant', content: reply }, done: true });
    }
    return send(404, {});
  });

  await new Promise((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    state,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
