import test from 'node:test';
import assert from 'node:assert/strict';
import { OllamaClient, isAllowedChatModel, isInstalled, selectableChatModels } from '../../src/services/ollama.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const client = (fetchImpl, opts = {}) =>
  new OllamaClient({ baseUrl: 'http://127.0.0.1:11434', embedTimeoutMs: 1000, chatTimeoutMs: 1000, fetchImpl, ...opts });

test('isInstalled matches base names, tags and :latest', () => {
  const models = [{ name: 'gemma3:latest' }, { name: 'llama3:8b' }, { name: 'nomic-embed-text:latest' }];
  assert.equal(isInstalled(models, 'gemma3'), true);
  assert.equal(isInstalled(models, 'gemma3:latest'), true);
  assert.equal(isInstalled(models, 'llama3:8b'), true);
  assert.equal(isInstalled(models, 'llama3:70b'), false);
  assert.equal(isInstalled(models, 'nomic-embed-text'), true);
  assert.equal(isInstalled(models, 'mistral'), false);
});

test('only allow-listed chat models are selectable; embedding models never are', () => {
  const models = [{ name: 'gemma3:latest' }, { name: 'nomic-embed-text:latest' }, { name: 'mistral:7b' }, { name: 'llama3:latest' }];
  const names = selectableChatModels(models, ['gemma3', 'llama3'], 'gemma3:latest').map((m) => m.name);
  assert.deepEqual(names, ['gemma3:latest', 'llama3:latest']);
  assert.equal(isAllowedChatModel('mistral:7b', ['gemma3'], 'gemma3:latest'), false);
  assert.equal(isAllowedChatModel('nomic-embed-text', ['gemma3'], 'gemma3:latest'), false);
});

test('connection failure -> 503 OLLAMA_UNAVAILABLE with a helpful message', async () => {
  const c = client(async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(c.listModels(), (e) => e.status === 503 && e.code === 'OLLAMA_UNAVAILABLE' && /ollama list/.test(e.message));
});

test('timeout -> 504 OLLAMA_TIMEOUT', async () => {
  const c = client(async () => {
    throw new DOMException('timed out', 'TimeoutError');
  });
  await assert.rejects(c.chat('gemma3', []), (e) => e.status === 504 && e.code === 'OLLAMA_TIMEOUT');
});

test('undici headers timeout is reported as a timeout, not as "Ollama offline"', async () => {
  const c = client(async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } });
  });
  await assert.rejects(c.chat('gemma3', []), (e) => e.code === 'OLLAMA_TIMEOUT');
});

test('a real slow response is aborted by the timeout', async () => {
  const slow = (_url, { signal }) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const c = client(slow, { chatTimeoutMs: 30 });
  const keepAlive = setInterval(() => {}, 10); // AbortSignal.timeout timers are unref'd; a real server keeps the loop alive
  try {
    await assert.rejects(c.chat('gemma3', [{ role: 'user', content: 'hi' }]), (e) => e.code === 'OLLAMA_TIMEOUT');
  } finally {
    clearInterval(keepAlive);
  }
});

test('client cancellation is distinguished from timeouts', async () => {
  const controller = new AbortController();
  const slow = (_url, { signal }) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const c = client(slow, { chatTimeoutMs: 5000 });
  const pending = c.chat('gemma3', [], { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (e) => e.code === 'CLIENT_CANCELLED');
});

test('missing model -> MODEL_NOT_FOUND with pull instructions', async () => {
  const c = client(async () => json({ error: 'model "x" not found, try pulling it first' }, 404));
  await assert.rejects(c.embed('x', ['hi']), (e) => e.code === 'MODEL_NOT_FOUND' && /ollama pull/.test(e.message));
});

test('embed validates response shape and returns vectors in order', async () => {
  const ok = client(async () => json({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }));
  assert.deepEqual(await ok.embed('m', ['a', 'b']), [[0.1, 0.2], [0.3, 0.4]]);
  const wrongCount = client(async () => json({ embeddings: [[0.1]] }));
  await assert.rejects(wrongCount.embed('m', ['a', 'b']), (e) => e.status === 502);
  const notNumbers = client(async () => json({ embeddings: [['x']] }));
  await assert.rejects(notNumbers.embed('m', ['a']), (e) => e.status === 502);
});

test('embed falls back to legacy /api/embeddings on old Ollama versions', async () => {
  const calls = [];
  const c = client(async (url, init) => {
    calls.push(new URL(url).pathname);
    if (url.endsWith('/api/embed')) return new Response('404 page not found', { status: 404 });
    return json({ embedding: [JSON.parse(init.body).prompt.length, 1] });
  });
  assert.deepEqual(await c.embed('m', ['abc', 'de']), [[3, 1], [2, 1]]);
  assert.deepEqual(calls, ['/api/embed', '/api/embeddings', '/api/embeddings']);
});

test('chat sends stream:false and returns trimmed content', async () => {
  let sent;
  const c = client(async (_url, init) => {
    sent = JSON.parse(init.body);
    return json({ message: { content: '  hello  ' } });
  });
  assert.equal(await c.chat('gemma3', [{ role: 'user', content: 'hi' }], { numCtx: 2048 }), 'hello');
  assert.equal(sent.stream, false);
  assert.equal(sent.options.num_ctx, 2048);
});

test('malformed chat response -> 502', async () => {
  const c = client(async () => json({ nope: true }));
  await assert.rejects(c.chat('gemma3', []), (e) => e.status === 502);
});
