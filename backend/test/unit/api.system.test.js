import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startMockOllama } from '../helpers/mockOllama.js';
import { buildTestApp, clientFor, offlineOllama } from '../helpers/app.js';

let mock;
before(async () => {
  mock = await startMockOllama();
});
after(() => mock.close());

test('GET /api/health reports ready when Ollama and both models are present', async () => {
  const t = await buildTestApp({ ollama: clientFor(mock) });
  const res = await request(t.app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.mode, 'local-portfolio-demo');
  assert.equal(res.body.ollama.reachable, true);
  assert.equal(res.body.ollama.ready, true);
  assert.deepEqual(res.body.ollama.missingModels, []);
  await t.cleanup();
});

test('GET /api/health lists missing models', async () => {
  const noEmbed = await startMockOllama({ models: ['gemma3:latest'] });
  const t = await buildTestApp({ ollama: clientFor(noEmbed) });
  const res = await request(t.app).get('/api/health');
  assert.equal(res.body.ollama.ready, false);
  assert.deepEqual(res.body.ollama.missingModels, ['nomic-embed-text:latest']);
  await noEmbed.close();
  await t.cleanup();
});

test('GET /api/health stays HTTP 200 when Ollama is offline', async () => {
  const t = await buildTestApp({ ollama: offlineOllama() });
  const res = await request(t.app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ollama.reachable, false);
  assert.equal(res.body.ollama.code, 'OLLAMA_UNAVAILABLE');
  await t.cleanup();
});

test('GET /api/health against a port with nothing listening reports "not reachable"', async () => {
  const t = await buildTestApp({ env: { OLLAMA_BASE_URL: 'http://127.0.0.1:1' } });
  const res = await request(t.app).get('/api/health');
  assert.equal(res.body.ollama.reachable, false);
  assert.equal(res.body.ollama.code, 'OLLAMA_UNAVAILABLE');
  await t.cleanup();
});

test('GET /api/models returns only allowed installed chat models', async () => {
  const t = await buildTestApp({ ollama: clientFor(mock) });
  const res = await request(t.app).get('/api/models');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.models.map((m) => m.name).sort(), ['gemma3:latest', 'llama3:latest']);
  assert.equal(res.body.defaultModel, 'gemma3:latest');
  await t.cleanup();
});

test('GET /api/models -> 503 JSON error when Ollama is offline', async () => {
  const t = await buildTestApp({ ollama: offlineOllama() });
  const res = await request(t.app).get('/api/models');
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'OLLAMA_UNAVAILABLE');
  await t.cleanup();
});

test('GET /api/settings and /api/stats expose only safe values', async () => {
  const t = await buildTestApp({ ollama: clientFor(mock) });
  const settings = await request(t.app).get('/api/settings');
  assert.equal(settings.status, 200);
  assert.equal(settings.body.maxUploadMb, 10);
  assert.ok(!JSON.stringify(settings.body).includes(t.dataDir));
  const stats = await request(t.app).get('/api/stats');
  assert.deepEqual(stats.body, { documents: 0, byStatus: { queued: 0, processing: 0, ready: 0, failed: 0 }, totalChunks: 0, totalBytes: 0 });
  await t.cleanup();
});

test('unknown API routes return a JSON 404', async () => {
  const t = await buildTestApp({ ollama: offlineOllama() });
  const res = await request(t.app).get('/api/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
  await t.cleanup();
});

test('malformed JSON -> 400 without leaking internals', async () => {
  const t = await buildTestApp({ ollama: offlineOllama() });
  const res = await request(t.app).post('/api/chat/ask').set('Content-Type', 'application/json').send('{bad json');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_JSON');
  assert.ok(!JSON.stringify(res.body).includes('node_modules'));
  await t.cleanup();
});

test('oversized JSON bodies are rejected with 413', async () => {
  const t = await buildTestApp({ ollama: offlineOllama() });
  const res = await request(t.app).post('/api/chat/ask').send({ question: 'x'.repeat(200_000) });
  assert.equal(res.status, 413);
  await t.cleanup();
});

test('the general rate limiter returns 429 JSON when exceeded', async () => {
  const t = await buildTestApp({ ollama: clientFor(mock), env: { RATE_LIMIT_API_PER_MINUTE: '5' } });
  let last;
  for (let i = 0; i < 6; i++) last = await request(t.app).get('/api/settings');
  assert.equal(last.status, 429);
  assert.equal(last.body.error.code, 'RATE_LIMITED');
  await t.cleanup();
});

test('security headers are set, x-powered-by is hidden, CORS is limited to configured origins', async () => {
  const t = await buildTestApp({ ollama: offlineOllama() });
  const res = await request(t.app).get('/api/settings').set('Origin', 'http://localhost:4200');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.headers['content-security-policy']);
  assert.ok(!res.headers['content-security-policy'].includes('upgrade-insecure-requests'));
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:4200');
  const evil = await request(t.app).get('/api/settings').set('Origin', 'http://evil.example');
  assert.notEqual(evil.headers['access-control-allow-origin'], 'http://evil.example');
  await t.cleanup();
});
