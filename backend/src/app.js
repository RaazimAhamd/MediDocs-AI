import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createRateLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { systemRouter } from './routes/system.js';
import { documentsRouter } from './routes/documents.js';
import { chatRouter } from './routes/chat.js';

export function createApp({ container, logger = console }) {
  const { config, ollama, documents, rag } = container;
  const app = express();

  app.disable('x-powered-by');
  app.use(
    helmet({
      hsts: false, // plain-HTTP local demo
      contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } },
    }),
  );
  app.use(cors({ origin: config.corsOrigins }));
  if (config.logRequests) app.use(requestLogger(logger));
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();
  api.use(
    createRateLimiter({
      limit: config.rateLimits.api,
      message: 'Too many requests. Please wait a moment and try again.',
    }),
  );
  api.use(systemRouter({ config, ollama, documents }));
  api.use(
    '/documents',
    documentsRouter({
      config,
      documents,
      uploadLimiter: createRateLimiter({
        limit: config.rateLimits.upload,
        message: 'Too many uploads. Please wait a minute and try again.',
      }),
    }),
  );
  api.use(
    '/chat',
    chatRouter({
      rag,
      askLimiter: createRateLimiter({
        limit: config.rateLimits.ask,
        message: 'You are asking questions too quickly. Please wait a moment.',
      }),
    }),
  );
  app.use('/api', api);

  // Optional single-port mode: serve the compiled Angular app (never the uploads folder).
  const indexHtml = path.join(config.frontendDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.frontendDist, { index: false }));
    // Client-side routes (no file extension) get index.html; anything that looks like a file is a real 404.
    app.get(/^\/(?!api(\/|$)).*/, (req, res, next) =>
      path.extname(req.path) ? next() : res.sendFile(indexHtml),
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
