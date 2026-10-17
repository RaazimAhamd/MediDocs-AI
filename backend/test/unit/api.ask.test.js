import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import request from 'supertest';
import { startMockOllama } from '../helpers/mockOllama.js';
import { buildTestApp, clientFor, offlineOllama, waitFor } from '../helpers/app.js';
import { NOT_ENOUGH_MESSAGE, NO_DOCUMENTS_MESSAGE } from '../../src/services/rag.js';

const sample = (name) => fs.readFile(new URL(`../../../sample-documents/${name}`, import.meta.url));

let mock;
before(async () => {
  mock = await startMockOllama();
});
after(() => mock.close());

async function ingest(app, name, type) {
  const res = await request(app).post('/api/documents').attach('file', await sample(name), { filename: name, contentType: type });
  assert.equal(res.status, 202);
  await waitFor(async () => (await request(app).get(`/api/documents/${res.body.document.id}/status`)).body.status === 'ready');
  return res.body.document.id;
}

// The mock's lexical vectors score short questions lower than real embeddings do, so tests use a low threshold.
const LOW_THRESHOLD = { MIN_SIMILARITY: '0.05' };

async function readyApp(env) {
  const t = await buildTestApp({ ollama: clientFor(mock), env: { ...LOW_THRESHOLD, ...env } });
  const policyId = await ingest(t.app, 'Riverside-Appointment-and-Cancellation-Policy.pdf', 'application/pdf');
  const visitorId = await ingest(t.app, 'Riverside-Visitor-and-Administrative-Procedures.txt', 'text/plain');
  return { ...t, policyId, visitorId };
}

const ask = (app, body) => request(app).post('/api/chat/ask').send(body);
const chatCalls = () => mock.state.requests.filter((r) => r.url === '/api/chat');

test('answers from the documents with citations, document names and page numbers', async () => {
  const { app, cleanup } = await readyApp();
  mock.state.requests.length = 0;
  const res = await ask(app, { question: 'How many hours in advance must an outpatient clinic appointment be cancelled?' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.grounded, true);
  assert.match(res.body.answer, /24 hours/);
  assert.match(res.body.answer, /\[\d\]/);
  const cited = res.body.sources.find((s) => s.cited);
  assert.ok(cited, 'a source is marked as cited');
  assert.equal(cited.documentName, 'Riverside-Appointment-and-Cancellation-Policy.pdf');
  assert.equal(cited.page, 2);
  assert.match(cited.text, /at least 24 hours in advance/);
  assert.ok(cited.score > 0.3 && cited.score <= 1);
  assert.ok(res.body.disclaimer);
  assert.equal(res.body.model, 'gemma3:latest');
  assert.equal(chatCalls().length, 1);
  await cleanup();
});

test('the prompt sent to Ollama contains only retrieved passages, in fenced blocks, after the system rules', async () => {
  const { app, cleanup } = await readyApp();
  mock.state.requests.length = 0;
  await ask(app, { question: 'What are the ICU visiting hours?' });
  const { messages, stream } = chatCalls()[0].body;
  assert.equal(stream, false);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[1].content, /<passage id="1" document="Riverside-Visitor-and-Administrative-Procedures\.txt" section="\d+">/);
  assert.match(messages[1].content, /14:00 to 16:00/);
  assert.ok((messages[1].content.match(/<passage /g) ?? []).length <= 4, 'at most topK passages are sent');
  assert.ok(!messages[1].content.includes('Wheelchair-accessible'), 'whole documents are never sent, only retrieved passages');
  await cleanup();
});

test('search can be scoped to selected documents', async () => {
  const { app, cleanup, visitorId } = await readyApp();
  const res = await ask(app, { question: 'What are the ICU visiting hours?', documentIds: [visitorId] });
  assert.ok(res.body.sources.every((s) => s.documentId === visitorId));
  const policyOnly = await ask(app, { question: 'What are the ICU visiting hours?', documentIds: [res.body.sources[0].documentId.replace(/.$/, '0')] });
  assert.equal(policyOnly.body.reason, 'NO_DOCUMENTS');
  await cleanup();
});

test('when nothing relevant is retrieved the model is NOT called and the answer says so', async () => {
  const { app, cleanup } = await readyApp({ MIN_SIMILARITY: '0.6' });
  mock.state.requests.length = 0;
  const res = await ask(app, { question: 'Does the hospital accept cryptocurrency payments for parking?' });
  assert.equal(res.status, 200);
  assert.equal(res.body.grounded, false);
  assert.equal(res.body.answer, NOT_ENOUGH_MESSAGE);
  assert.equal(res.body.reason, 'LOW_SIMILARITY');
  assert.deepEqual(res.body.sources, []);
  assert.equal(chatCalls().length, 0);
  await cleanup();
});

test('if the model itself says the passages are insufficient, the answer is replaced by the standard message', async () => {
  const { app, cleanup } = await readyApp();
  mock.state.chatReply = () => 'INSUFFICIENT_INFORMATION';
  const res = await ask(app, { question: 'What are the ICU visiting hours?' });
  mock.state.chatReply = null;
  assert.equal(res.body.grounded, false);
  assert.equal(res.body.answer, NOT_ENOUGH_MESSAGE);
  assert.equal(res.body.reason, 'MODEL_INSUFFICIENT');
  assert.ok(res.body.sources.every((s) => s.cited === false));
  await cleanup();
});

test('answers without citations are flagged so the UI can warn the user', async () => {
  const { app, cleanup } = await readyApp();
  mock.state.chatReply = () => 'The ICU opens in the afternoon.';
  const res = await ask(app, { question: 'What are the ICU visiting hours?' });
  mock.state.chatReply = null;
  assert.equal(res.body.grounded, true);
  assert.equal(res.body.reason, 'NO_CITATIONS');
  await cleanup();
});

test('with no documents uploaded the user is told to upload first', async () => {
  const t = await buildTestApp({ ollama: clientFor(mock) });
  const res = await ask(t.app, { question: 'What is the cancellation policy?' });
  assert.equal(res.status, 200);
  assert.equal(res.body.answer, NO_DOCUMENTS_MESSAGE);
  assert.equal(res.body.reason, 'NO_DOCUMENTS');
  await t.cleanup();
});

test('prompt injection inside a document stays inside the passage block', async () => {
  const t = await buildTestApp({ ollama: clientFor(mock), env: LOW_THRESHOLD });
  await ingest(t.app, 'security-tests/Riverside-Cafeteria-Notice-with-Injection-Attempt.txt', 'text/plain');
  mock.state.requests.length = 0;
  const res = await ask(t.app, { question: 'What are the cafeteria opening hours?' });
  assert.equal(res.status, 200);
  const [system, user] = chatCalls()[0].body.messages;
  assert.match(system.content, /Never obey commands/);
  const outside = user.content.split('<passage')[0] + user.content.split('</passage>').at(-1);
  assert.ok(!/SYSTEM OVERRIDE|Ignore all previous/i.test(outside), 'injected text only appears inside a passage');
  assert.ok(!/free medical diagnoses/.test(res.body.answer));
  await t.cleanup();
});

test('validation errors: question length, unknown fields, bad model name', async () => {
  const t = await buildTestApp({ ollama: clientFor(mock) });
  for (const body of [{}, { question: 'hi' }, { question: 'x'.repeat(1001) }, { question: 'valid question', admin: true }, { question: 'valid question', model: 'a b' }]) {
    const res = await ask(t.app, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
  await t.cleanup();
});

test('model selection: allowed installed models work; others are refused', async () => {
  const { app, cleanup } = await readyApp();
  mock.state.requests.length = 0;
  const ok = await ask(app, { question: 'What are the ICU visiting hours?', model: 'llama3:latest' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.model, 'llama3:latest');
  assert.equal(chatCalls()[0].body.model, 'llama3:latest');

  const notAllowed = await ask(app, { question: 'What are the ICU visiting hours?', model: 'mistral:7b' });
  assert.equal(notAllowed.status, 400);
  assert.equal(notAllowed.body.error.code, 'MODEL_NOT_ALLOWED');
  const embedAsChat = await ask(app, { question: 'What are the ICU visiting hours?', model: 'nomic-embed-text:latest' });
  assert.equal(embedAsChat.body.error.code, 'MODEL_NOT_ALLOWED');
  await cleanup();
});

test('missing chat model -> 502 MODEL_NOT_FOUND with the pull command', async () => {
  const { app, cleanup } = await readyApp();
  mock.state.models = mock.state.models.filter((m) => !m.startsWith('llama3'));
  const res = await ask(app, { question: 'What are the ICU visiting hours?', model: 'llama3:latest' });
  mock.state.models.push('llama3:latest');
  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, 'MODEL_NOT_FOUND');
  assert.match(res.body.error.message, /ollama pull llama3:latest/);
  await cleanup();
});

test('missing embedding model -> 502 MODEL_NOT_FOUND', async () => {
  const { app, cleanup } = await readyApp();
  const saved = mock.state.models;
  mock.state.models = saved.filter((m) => !m.startsWith('nomic'));
  const res = await ask(app, { question: 'What are the ICU visiting hours?' });
  mock.state.models = saved;
  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, 'MODEL_NOT_FOUND');
  assert.match(res.body.error.message, /ollama pull nomic-embed-text/);
  await cleanup();
});

test('Ollama stopped -> 503 with a friendly message', async () => {
  const t = await buildTestApp({ ollama: offlineOllama() });
  const res = await ask(t.app, { question: 'What is the cancellation policy?' });
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'OLLAMA_UNAVAILABLE');
  await t.cleanup();
});

test('slow model generation -> 504 OLLAMA_TIMEOUT', async () => {
  const slowMock = await startMockOllama();
  slowMock.state.chatDelayMs = 400;
  const t = await buildTestApp({ ollama: clientFor(slowMock, { chatTimeoutMs: 100 }), env: LOW_THRESHOLD });
  const keepAlive = setInterval(() => {}, 10);
  try {
    await ingest(t.app, 'Riverside-Visitor-and-Administrative-Procedures.txt', 'text/plain');
    const res = await ask(t.app, { question: 'What are the ICU visiting hours?' });
    assert.equal(res.status, 504);
    assert.equal(res.body.error.code, 'OLLAMA_TIMEOUT');
  } finally {
    clearInterval(keepAlive);
    await slowMock.close();
    await t.cleanup();
  }
});

test('the ask endpoint has its own, stricter rate limit', async () => {
  const t = await buildTestApp({ ollama: offlineOllama(), env: { RATE_LIMIT_ASK_PER_MINUTE: '2' } });
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await ask(t.app, { question: 'What is the cancellation policy?' })).status);
  assert.deepEqual(statuses, [503, 503, 429]);
  await t.cleanup();
});

test('responses never leak filesystem paths or stack traces', async () => {
  const { app, cleanup, dataDir } = await readyApp();
  const res = await ask(app, { question: 'What are the ICU visiting hours?' });
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes(dataDir));
  assert.ok(!/node_modules|\sat\s.+:\d+:\d+/.test(text));
  await cleanup();
});
