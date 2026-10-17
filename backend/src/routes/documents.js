import { Router } from 'express';
import { asyncHandler, parseId, parseWith } from '../utils/http.js';
import { chunkIndexSchema, chunkListQuerySchema } from '../utils/validation.js';
import { createUploadMiddleware } from '../middleware/upload.js';

export function documentsRouter({ config, documents, uploadLimiter }) {
  const router = Router();
  const upload = createUploadMiddleware(config);

  router.get('/', (_req, res) => {
    res.json({ documents: documents.list() });
  });

  router.post(
    '/',
    uploadLimiter,
    upload,
    asyncHandler(async (req, res) => {
      const document = await documents.createFromUpload(req.file);
      res.status(202).json({ document });
    }),
  );

  router.get('/:id', (req, res) => {
    res.json({ document: documents.get(parseId(req.params.id)) });
  });

  router.get('/:id/status', (req, res) => {
    res.json(documents.getStatus(parseId(req.params.id)));
  });

  router.get(
    '/:id/chunks',
    asyncHandler(async (req, res) => {
      const query = parseWith(chunkListQuerySchema, req.query);
      res.json(await documents.listChunks(parseId(req.params.id), query));
    }),
  );

  router.get(
    '/:id/chunks/:index',
    asyncHandler(async (req, res) => {
      const index = parseWith(chunkIndexSchema, req.params.index);
      res.json(await documents.getChunk(parseId(req.params.id), index));
    }),
  );

  router.post(
    '/:id/retry',
    asyncHandler(async (req, res) => {
      res.status(202).json({ document: await documents.retry(parseId(req.params.id)) });
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(req.params.id);
      await documents.remove(id);
      res.json({ deleted: true, id });
    }),
  );

  return router;
}
