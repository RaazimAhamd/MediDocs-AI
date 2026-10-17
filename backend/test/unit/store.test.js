import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentStore } from '../../src/storage/documentStore.js';
import { normalize } from '../../src/utils/vector.js';
import { silentLogger } from '../helpers/app.js';

const ID = '11111111-1111-4111-8111-111111111111';
const doc = (over = {}) => ({
  id: ID,
  originalName: 'a.txt',
  extension: '.txt',
  sizeBytes: 3,
  uploadedAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  status: 'ready',
  ...over,
});

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'medidocs-store-'));
}

test('documents and embeddings survive a restart', async () => {
  const dir = await tmp();
  const a = new DocumentStore(dir, silentLogger);
  await a.init();
  await a.insert(doc());
  await a.saveChunks(ID, {
    embedModel: 'nomic-embed-text:latest',
    dim: 3,
    chunks: [{ index: 0, page: 1, text: 'hello', vector: normalize([1, 2, 3]) }],
  });

  const b = new DocumentStore(dir, silentLogger);
  await b.init();
  assert.equal(b.list().length, 1);
  const loaded = await b.loadChunks(ID);
  assert.equal(loaded.chunks[0].text, 'hello');
  assert.equal(loaded.chunks[0].page, 1);
  assert.ok(Math.abs(loaded.chunks[0].vector[2] - normalize([1, 2, 3])[2]) < 1e-6);
  await fs.rm(dir, { recursive: true, force: true });
});

test('remove deletes metadata, chunk file and upload', async () => {
  const dir = await tmp();
  const s = new DocumentStore(dir, silentLogger);
  await s.init();
  const d = doc();
  await s.insert(d);
  await fs.writeFile(s.uploadPath(d), 'abc');
  await s.saveChunks(ID, { embedModel: 'm', dim: 1, chunks: [{ index: 0, page: null, text: 't', vector: Float32Array.from([1]) }] });
  await s.remove(ID);
  assert.equal(s.list().length, 0);
  await assert.rejects(fs.access(s.uploadPath(d)));
  await assert.rejects(fs.access(s.chunkFile(ID)));
  assert.equal(await s.loadChunks(ID), null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('a corrupt documents.json is set aside and the app starts empty', async () => {
  const dir = await tmp();
  await fs.mkdir(path.join(dir, 'db'), { recursive: true });
  await fs.writeFile(path.join(dir, 'db', 'documents.json'), '{not json');
  const s = new DocumentStore(dir, silentLogger);
  await s.init();
  assert.equal(s.list().length, 0);
  const files = await fs.readdir(path.join(dir, 'db'));
  assert.ok(files.some((f) => f.includes('.corrupt-')));
  await fs.rm(dir, { recursive: true, force: true });
});

test('atomic writes leave no temp files behind', async () => {
  const dir = await tmp();
  const s = new DocumentStore(dir, silentLogger);
  await s.init();
  await Promise.all([s.insert(doc()), s.update(ID, { status: 'failed' }), s.update(ID, { status: 'ready' })]);
  const files = await fs.readdir(path.join(dir, 'db'));
  assert.deepEqual(files.filter((f) => f.endsWith('.tmp')), []);
  await fs.rm(dir, { recursive: true, force: true });
});

test('file paths are only built from valid UUIDs', async () => {
  const dir = await tmp();
  const s = new DocumentStore(dir, silentLogger);
  assert.throws(() => s.chunkFile('../../etc/passwd'));
  assert.throws(() => s.uploadPath({ id: '..\\..\\evil', extension: '.pdf' }));
  await fs.rm(dir, { recursive: true, force: true });
});
