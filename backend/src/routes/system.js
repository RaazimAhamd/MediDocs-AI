import { Router } from 'express';
import { asyncHandler } from '../utils/http.js';
import { isInstalled, selectableChatModels } from '../services/ollama.js';

export function systemRouter({ config, ollama, documents }) {
  const router = Router();

  // The API is "ok" whenever this responds; Ollama's state is reported inside the body.
  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const base = {
        status: 'ok',
        app: 'MediDocs AI',
        mode: 'local-portfolio-demo',
        time: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
      };
      try {
        const [version, models] = await Promise.all([ollama.version(), ollama.listModels()]);
        const chatInstalled = isInstalled(models, config.ollama.chatModel);
        const embedInstalled = isInstalled(models, config.ollama.embedModel);
        const missingModels = [];
        if (!chatInstalled) missingModels.push(config.ollama.chatModel);
        if (!embedInstalled) missingModels.push(config.ollama.embedModel);
        res.json({
          ...base,
          ollama: {
            reachable: true,
            version,
            chatModel: { name: config.ollama.chatModel, installed: chatInstalled },
            embedModel: { name: config.ollama.embedModel, installed: embedInstalled },
            missingModels,
            ready: missingModels.length === 0,
          },
        });
      } catch (err) {
        res.json({
          ...base,
          ollama: { reachable: false, ready: false, code: err.code ?? 'OLLAMA_ERROR', message: err.message },
        });
      }
    }),
  );

  router.get(
    '/models',
    asyncHandler(async (_req, res) => {
      const installed = await ollama.listModels();
      res.json({
        defaultModel: config.ollama.chatModel,
        embedModel: config.ollama.embedModel,
        models: selectableChatModels(installed, config.ollama.allowedChatModels, config.ollama.chatModel),
      });
    }),
  );

  router.get('/settings', (_req, res) => {
    res.json({
      maxUploadMb: +(config.maxUploadBytes / (1024 * 1024)).toFixed(2),
      allowedExtensions: ['.pdf', '.txt'],
      chunkSize: config.rag.chunkSize,
      chunkOverlap: config.rag.chunkOverlap,
      topK: config.rag.topK,
      minSimilarity: config.rag.minSimilarity,
      defaultModel: config.ollama.chatModel,
      embedModel: config.ollama.embedModel,
    });
  });

  router.get('/stats', (_req, res) => {
    const docs = documents.list();
    const byStatus = { queued: 0, processing: 0, ready: 0, failed: 0 };
    let totalBytes = 0;
    let totalChunks = 0;
    for (const d of docs) {
      byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
      totalBytes += d.sizeBytes;
      totalChunks += d.chunkCount;
    }
    res.json({ documents: docs.length, byStatus, totalChunks, totalBytes });
  });

  return router;
}
