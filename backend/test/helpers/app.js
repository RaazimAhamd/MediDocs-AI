import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config/index.js';
import { createApp } from '../../src/app.js';
import { createContainer } from '../../src/services/container.js';
import { OllamaClient } from '../../src/services/ollama.js';
import { AppError } from '../../src/errors.js';

export const silentLogger = { log() {}, warn() {}, error() {} };

export function testConfig(env = {}) {
  return loadConfig({ LOG_REQUESTS: 'false', FRONTEND_DIST: './does-not-exist', ...env });
}

/** Builds the full Express app with a temp data dir. Call `cleanup()` when done. */
export async function buildTestApp({ ollama, env = {} } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'medidocs-test-'));
  const config = testConfig({ DATA_DIR: dataDir, ...env });
  const client = ollama ?? new OllamaClient({ baseUrl: config.ollama.baseUrl });
  const container = await createContainer({ config, ollama: client, logger: silentLogger });
  const app = createApp({ container, logger: silentLogger });
  return {
    app,
    container,
    config,
    dataDir,
    cleanup: () => fs.rm(dataDir, { recursive: true, force: true }),
  };
}

export function clientFor(mock, config = {}) {
  return new OllamaClient({ baseUrl: mock.baseUrl, embedTimeoutMs: 5000, chatTimeoutMs: 5000, ...config });
}

/** A fake client whose every call fails like an unreachable Ollama. */
export function offlineOllama() {
  const down = async () => {
    throw AppError.serviceUnavailable('Cannot reach Ollama.');
  };
  return { version: down, listModels: down, embed: down, chat: down };
}

export async function waitFor(check, { timeoutMs = 8000, intervalMs = 20 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
