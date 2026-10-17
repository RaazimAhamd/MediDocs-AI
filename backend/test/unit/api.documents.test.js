import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { startMockOllama } from '../helpers/mockOllama.js';
import { buildTestApp, clientFor, waitFor } from '../helpers/app.js';

const fixture = (name) => fs.readFile(new URL(`../fixtures/${name}`, import.meta.url));
const pdfBytes = () => fixture('sample-policy.pdf');
const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';

let mock;
let t;
before(async () => {
  mock = await startMockOllama();
});
after(() => mock.close());

async function fresh(env) {
  t = await buildTestApp({ ollama: clientFor(mock), env });
  return t;
}

const upload = (app, buffer, filename, contentType) =>
  request(app).post('/api/documents').attach('file', buffer, { filename, contentType });

async function uploadAndWait(app, buffer, filename, contentType) {
  const res = await upload(app, buffer, filename, contentType);
  assert.equal(res.status, 202, JSON.stringify(res.body));
  const id = res.body.document.id;
  const doc = await waitFor(async () => {
    const s = await request(app).get(`/api/documents/${id}/status`);
    return ['ready', 'failed'].includes(s.body.status) ? s.body : null;
  });
  return { id, status: doc };
}

test('upload validation: wrong extension, MIME mismatch, fake PDF, empty file, binary text, no file', async () => {
  const { app, cleanup } = await fresh();
  const cases = [
    [Buffer.from('MZ binary'), 'malware.exe', 'application/octet-stream', 415, 'UNSUPPORTED_EXTENSION'],
    [await pdfBytes(), 'policy.pdf', 'image/png', 415, 'MIME_MISMATCH'],
    [Buffer.from('this is plain text, not a pdf'), 'fake.pdf', 'application/pdf', 415, 'INVALID_PDF_SIGNATURE'],
    [Buffer.alloc(0), 'empty.txt', 'text/plain', 400, 'EMPTY_FILE'],
    [Buffer.from([1, 2, 0, 3]), 'binary.txt', 'text/plain', 415, 'INVALID_TEXT_FILE'],
    [Buffer.from('   \n  '), 'blank.txt', 'text/plain', 422, 'EMPTY_DOCUMENT'],
  ];
  for (const [buf, name, type, status, code] of cases) {
    const res = await upload(app, buf, name, type);
    assert.equal(res.status, status, `${name}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error.code, code, name);
  }
  const none = await request(app).post('/api/documents');
  assert.equal(none.status, 400);
  assert.equal(none.body.error.code, 'NO_FILE');
  const wrongField = await request(app).post('/api/documents').attach('upload', Buffer.from('hello'), 'a.txt');
  assert.equal(wrongField.status, 400);
  assert.equal((await request(app).get('/api/documents')).body.documents.length, 0);
  await cleanup();
});

test('upload validation: files over the size limit -> 413', async () => {
  const { app, cleanup } = await fresh({ MAX_UPLOAD_MB: '0.01' });
  const res = await upload(app, Buffer.from('a '.repeat(20_000)), 'big.txt', 'text/plain');
  assert.equal(res.status, 413);
  assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
  await cleanup();
});

test('a TXT upload is processed into embedded chunks and becomes ready', async () => {
  const { app, cleanup } = await fresh();
  const text = 'Visiting hours are 10:00 to 20:00 every day. '.repeat(60);
  const { id, status } = await uploadAndWait(app, Buffer.from(text), 'visiting.txt', 'text/plain');
  assert.equal(status.status, 'ready');
  assert.ok(status.chunkCount >= 3);

  const detail = (await request(app).get(`/api/documents/${id}`)).body.document;
  assert.equal(detail.name, 'visiting.txt');
  assert.equal(detail.pageCount, null);
  assert.equal(detail.embedModel, 'nomic-embed-text:latest');
  assert.equal(detail.chunkCount, status.chunkCount);

  const chunks = await request(app).get(`/api/documents/${id}/chunks?limit=2`);
  assert.equal(chunks.body.chunks.length, 2);
  assert.equal(chunks.body.total, status.chunkCount);

  const one = await request(app).get(`/api/documents/${id}/chunks/1`);
  assert.equal(one.status, 200);
  assert.equal(one.body.documentName, 'visiting.txt');
  assert.equal((await request(app).get(`/api/documents/${id}/chunks/9999`)).status, 404);
  await cleanup();
});

test('a PDF upload keeps page numbers and the embed requests used the nomic task prefix', async () => {
  const { app, cleanup } = await fresh();
  mock.state.requests.length = 0;
  const { id, status } = await uploadAndWait(app, await pdfBytes(), 'policy.pdf', 'application/pdf');
  assert.equal(status.status, 'ready');
  assert.equal(status.pageCount, 3);
  const chunks = (await request(app).get(`/api/documents/${id}/chunks?limit=50`)).body.chunks;
  assert.deepEqual([...new Set(chunks.map((c) => c.page))], [1, 2, 3]);
  const embedCall = mock.state.requests.find((r) => r.url === '/api/embed');
  assert.ok(embedCall.body.input.every((s) => s.startsWith('search_document: ')));
  await cleanup();
});

test('malformed, scanned and encrypted PDFs end as failed with a readable error', async () => {
  const { app, cleanup } = await fresh();
  const expectations = [
    ['malformed.pdf', 'PDF_INVALID'],
    ['no-text.pdf', 'PDF_NO_TEXT'],
    ['encrypted.pdf', 'PDF_ENCRYPTED'],
  ];
  for (const [file, code] of expectations) {
    const { status } = await uploadAndWait(app, await fixture(file), file, 'application/pdf');
    assert.equal(status.status, 'failed', file);
    assert.equal(status.error.code, code, file);
    assert.ok(status.error.message.length > 10);
  }
  await cleanup();
});

test('when the embedding model is missing, processing fails clearly and can be retried', async () => {
  const noEmbed = await startMockOllama({ models: ['gemma3:latest'] });
  const { app, cleanup } = await buildTestApp({ ollama: clientFor(noEmbed) });
  const { id, status } = await uploadAndWait(app, Buffer.from('Some policy text about visiting hours.'), 'a.txt', 'text/plain');
  assert.equal(status.status, 'failed');
  assert.equal(status.error.code, 'MODEL_NOT_FOUND');
  assert.match(status.error.message, /ollama pull/);

  assert.equal((await request(app).post(`/api/documents/${id}/retry`)).status, 202);
  noEmbed.state.models.push('nomic-embed-text:latest'); // user ran "ollama pull"
  const done = await waitFor(async () => {
    const s = (await request(app).get(`/api/documents/${id}/status`)).body;
    return s.status === 'ready' ? s : null;
  });
  assert.equal(done.status, 'ready');
  assert.equal((await request(app).post(`/api/documents/${id}/retry`)).status, 409);
  await noEmbed.close();
  await cleanup();
});

test('when Ollama is unreachable, the upload is accepted and processing fails with a friendly message', async () => {
  const { app, cleanup } = await buildTestApp({ env: { OLLAMA_BASE_URL: 'http://127.0.0.1:1' } });
  const { status } = await uploadAndWait(app, Buffer.from('Some text to embed later.'), 'a.txt', 'text/plain');
  assert.equal(status.status, 'failed');
  assert.equal(status.error.code, 'OLLAMA_UNAVAILABLE');
  await cleanup();
});

test('deleting a document removes metadata, chunks, embeddings and the stored upload', async () => {
  const { app, cleanup, dataDir } = await fresh();
  const { id } = await uploadAndWait(app, Buffer.from('Parking is free for 30 minutes. '.repeat(40)), 'parking.txt', 'text/plain');
  const stored = path.join(dataDir, 'uploads', `${id}.txt`);
  const chunkFile = path.join(dataDir, 'db', 'chunks', `${id}.json`);
  await fs.access(stored);
  await fs.access(chunkFile);

  const del = await request(app).delete(`/api/documents/${id}`);
  assert.equal(del.status, 200);
  assert.deepEqual(del.body, { deleted: true, id });
  await assert.rejects(fs.access(stored));
  await assert.rejects(fs.access(chunkFile));
  assert.equal((await request(app).get(`/api/documents/${id}`)).status, 404);
  assert.equal((await request(app).delete(`/api/documents/${id}`)).status, 404);
  assert.equal((await request(app).get('/api/stats')).body.totalChunks, 0);
  await cleanup();
});

test('deleting a document that is still processing leaves nothing behind', async () => {
  const { app, cleanup, container, dataDir } = await fresh();
  const res = await upload(app, Buffer.from('Slow processing text. '.repeat(500)), 'slow.txt', 'text/plain');
  await request(app).delete(`/api/documents/${res.body.document.id}`);
  await container.documents.whenIdle();
  assert.equal((await request(app).get('/api/documents')).body.documents.length, 0);
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'db', 'chunks')), []);
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'uploads')), []);
  await cleanup();
});

test('hostile file names never influence the stored path and are sanitised in responses', async () => {
  const { app, cleanup, dataDir } = await fresh();
  const res = await upload(app, Buffer.from('Harmless administrative text.'), '..\\..\\..\\Windows\\evil.txt', 'text/plain');
  assert.equal(res.status, 202);
  assert.equal(res.body.document.name, 'evil.txt');
  await container_idle(app);
  const files = await fs.readdir(path.join(dataDir, 'uploads'));
  assert.equal(files.length, 1);
  assert.match(files[0], /^[0-9a-f-]{36}\.txt$/);
  await cleanup();
});
async function container_idle(app) {
  await waitFor(async () => (await request(app).get('/api/stats')).body.byStatus.processing === 0 && (await request(app).get('/api/stats')).body.byStatus.queued === 0);
}

test('API responses never expose filesystem paths and uploads are not served statically', async () => {
  const { app, cleanup, dataDir } = await fresh();
  const { id } = await uploadAndWait(app, Buffer.from('Lost property is held for 30 days. '.repeat(10)), 'lost.txt', 'text/plain');
  for (const url of ['/api/documents', `/api/documents/${id}`, `/api/documents/${id}/status`, `/api/documents/${id}/chunks`, '/api/stats']) {
    const body = JSON.stringify((await request(app).get(url)).body);
    assert.ok(!body.includes(dataDir), url);
    assert.ok(!/uploads|storedName|\.json/.test(body), url);
  }
  for (const url of [`/uploads/${id}.txt`, `/data/uploads/${id}.txt`, `/${id}.txt`, `/api/uploads/${id}.txt`]) {
    const res = await request(app).get(url);
    assert.equal(res.status, 404, url);
  }
  await cleanup();
});

test('invalid ids and query values are rejected with 400, unknown ids with 404', async () => {
  const { app, cleanup } = await fresh();
  for (const url of ['/api/documents/not-a-uuid', '/api/documents/..%2F..%2Fetc%2Fpasswd', '/api/documents/not-a-uuid/status']) {
    const res = await request(app).get(url);
    assert.ok([400, 404].includes(res.status), url);
    assert.ok(res.body.error);
  }
  assert.equal((await request(app).get('/api/documents/not-a-uuid')).body.error.code, 'VALIDATION_ERROR');
  assert.equal((await request(app).get(`/api/documents/${UNKNOWN_ID}`)).status, 404);
  assert.equal((await request(app).get(`/api/documents/${UNKNOWN_ID}`)).body.error.code, 'DOCUMENT_NOT_FOUND');
  assert.equal((await request(app).delete(`/api/documents/${UNKNOWN_ID}`)).status, 404);
  assert.equal((await request(app).get(`/api/documents/${UNKNOWN_ID}/chunks?limit=0`)).status, 400);
  await cleanup();
});

test('documents left "processing" by a crash are re-queued on startup', async () => {
  const first = await fresh();
  const { id } = await uploadAndWait(first.app, Buffer.from('Complaints are acknowledged within 3 business days. '.repeat(20)), 'c.txt', 'text/plain');
  await first.container.store.update(id, { status: 'processing', stage: 'embedding', chunkCount: 0 });
  await fs.rm(path.join(first.dataDir, 'db', 'chunks', `${id}.json`), { force: true });

  const { createContainer } = await import('../../src/services/container.js');
  const { silentLogger } = await import('../helpers/app.js');
  const container = await createContainer({ config: first.config, ollama: clientFor(mock), logger: silentLogger, recover: true });
  await container.documents.whenIdle();
  assert.equal(container.documents.get(id).status, 'ready');
  await first.cleanup();
});
