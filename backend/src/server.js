import 'dotenv/config';
import { loadConfig } from './config/index.js';
import { OllamaClient } from './services/ollama.js';
import { createContainer } from './services/container.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`\n[startup] ${err.message}\n`);
  process.exit(1);
}

const ollama = new OllamaClient({
  baseUrl: config.ollama.baseUrl,
  embedTimeoutMs: config.ollama.embedTimeoutMs,
  chatTimeoutMs: config.ollama.chatTimeoutMs,
});

let container;
try {
  container = await createContainer({ config, ollama, recover: true });
} catch (err) {
  console.error(`\n[startup] Could not initialise storage in "${config.dataDir}": ${err.message}\n`);
  process.exit(1);
}

const app = createApp({ container });

// Loopback only: this demo has no authentication, so it must not be reachable from the network.
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`\nMediDocs AI backend  http://127.0.0.1:${config.port}   (health: /api/health)`);
  console.log('Local portfolio demo - no authentication. Use synthetic or public documents only.\n');
  ollama
    .listModels()
    .then(() => console.log(`[ollama] reachable at ${config.ollama.baseUrl}`))
    .catch(() =>
      console.warn(`[ollama] NOT reachable at ${config.ollama.baseUrl}. Start Ollama; the app will retry on each request.`),
    );
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[startup] Port ${config.port} is already in use. Close the other program or set PORT in backend/.env.\n`);
  } else {
    console.error('\n[startup]', err, '\n');
  }
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
