import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { buildTestApp, offlineOllama } from '../helpers/app.js';

test('single-port mode: serves the built app and SPA routes, never uploads, and keeps /api JSON 404s', async () => {
  const dist = await fs.mkdtemp(path.join(os.tmpdir(), 'medidocs-dist-'));
  await fs.writeFile(path.join(dist, 'index.html'), '<!doctype html><title>MediDocs test shell</title>');
  await fs.writeFile(path.join(dist, 'main.js'), 'console.log(1)');
  const t = await buildTestApp({ ollama: offlineOllama(), env: { FRONTEND_DIST: dist } });

  assert.match((await request(t.app).get('/')).text, /MediDocs test shell/);
  assert.match((await request(t.app).get('/chat')).text, /MediDocs test shell/, 'deep links fall back to index.html');
  assert.equal((await request(t.app).get('/main.js')).status, 200);
  assert.equal((await request(t.app).get('/uploads/secret.pdf')).status, 404);
  assert.equal((await request(t.app).get('/missing.css')).status, 404);
  const api = await request(t.app).get('/api/unknown');
  assert.equal(api.status, 404);
  assert.equal(api.body.error.code, 'ROUTE_NOT_FOUND');

  await t.cleanup();
  await fs.rm(dist, { recursive: true, force: true });
});
