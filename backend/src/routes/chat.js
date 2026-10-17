import { Router } from 'express';
import { asyncHandler, parseWith } from '../utils/http.js';
import { askSchema } from '../utils/validation.js';

export function chatRouter({ rag, askLimiter }) {
  const router = Router();

  router.post(
    '/ask',
    askLimiter,
    asyncHandler(async (req, res) => {
      const input = parseWith(askSchema, req.body ?? {});

      // If the browser cancels (or the tab closes), stop waiting on Ollama.
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });

      const result = await rag.ask({ ...input, signal: controller.signal });
      res.json(result);
    }),
  );

  return router;
}
