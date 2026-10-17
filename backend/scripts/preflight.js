/**
 * Pre-start check used by start.bat. Exit codes:
 *   0 = Ollama reachable and required models installed
 *   1 = Ollama not reachable
 *   2 = Ollama reachable but a required model is missing
 *   3 = invalid configuration
 */
import 'dotenv/config';
import { loadConfig } from '../src/config/index.js';
import { OllamaClient, isInstalled, selectableChatModels } from '../src/services/ollama.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(3);
}

const ollama = new OllamaClient({ baseUrl: config.ollama.baseUrl, embedTimeoutMs: 5000, chatTimeoutMs: 5000 });

try {
  const [version, models] = await Promise.all([ollama.version(), ollama.listModels()]);
  console.log(`[ok] Ollama ${version} is running at ${config.ollama.baseUrl}`);
  const missing = [config.ollama.embedModel, config.ollama.chatModel].filter((m) => !isInstalled(models, m));
  const selectable = selectableChatModels(models, config.ollama.allowedChatModels, config.ollama.chatModel);
  console.log(`[info] Installed chat models available in the app: ${selectable.map((m) => m.name).join(', ') || '(none)'}`);
  if (missing.length > 0) {
    console.error(`[missing] Required model(s) not installed: ${missing.join(', ')}`);
    for (const m of missing) console.error(`          ollama pull ${m}`);
    process.exit(2);
  }
  console.log(`[ok] Models ready: ${config.ollama.embedModel} (embeddings), ${config.ollama.chatModel} (chat)`);
} catch (err) {
  console.error(`[error] ${err.message}`);
  console.error('        Start Ollama (open the Ollama app, or run "ollama serve") and try again.');
  process.exit(1);
}
