import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config/index.js';

test('loadConfig applies safe defaults', () => {
  const c = loadConfig({});
  assert.equal(c.port, 3000);
  assert.equal(c.ollama.baseUrl, 'http://127.0.0.1:11434');
  assert.equal(c.ollama.chatModel, 'gemma3:latest');
  assert.equal(c.ollama.embedModel, 'nomic-embed-text:latest');
  assert.deepEqual(c.ollama.allowedChatModels, ['gemma3', 'llama3']);
  assert.deepEqual(c.corsOrigins, ['http://localhost:4200', 'http://127.0.0.1:4200']);
  assert.equal(c.maxUploadBytes, 10 * 1024 * 1024);
});

test('loadConfig rejects an overlap larger than half the chunk size', () => {
  assert.throws(() => loadConfig({ CHUNK_SIZE: '500', CHUNK_OVERLAP: '300' }), /CHUNK_OVERLAP/);
  assert.doesNotThrow(() => loadConfig({ CHUNK_SIZE: '500', CHUNK_OVERLAP: '250' }));
});

test('loadConfig rejects invalid port, URL and CORS origin', () => {
  assert.throws(() => loadConfig({ PORT: '99999' }), /PORT/);
  assert.throws(() => loadConfig({ OLLAMA_BASE_URL: 'not a url' }), /OLLAMA_BASE_URL/);
  assert.throws(() => loadConfig({ CORS_ORIGIN: 'http://ok.test,nope' }), /CORS_ORIGIN/);
});

test('loadConfig keeps the chat timeout below the 5 minute HTTP client limit', () => {
  assert.throws(() => loadConfig({ OLLAMA_CHAT_TIMEOUT_MS: '400000' }), /OLLAMA_CHAT_TIMEOUT_MS/);
});

test('DATA_DIR may be an absolute path containing spaces', () => {
  const dir = process.platform === 'win32' ? 'C:\\My Projects\\Medi Docs\\data' : '/tmp/My Projects/data';
  assert.equal(loadConfig({ DATA_DIR: dir }).dataDir, dir);
});
