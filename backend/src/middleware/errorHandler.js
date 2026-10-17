import { ZodError } from 'zod';
import { AppError } from '../errors.js';

export function notFoundHandler(req, _res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND'));
}

function normalize(err) {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = err.issues[0]?.message;
    return AppError.badRequest(first ? `Invalid request: ${first}` : 'Invalid request.', details, 'VALIDATION_ERROR');
  }
  if (err?.type === 'entity.parse.failed') {
    return AppError.badRequest('Request body is not valid JSON.', undefined, 'INVALID_JSON');
  }
  if (err?.type === 'entity.too.large') {
    return AppError.payloadTooLarge('Request body is too large.');
  }
  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') return AppError.payloadTooLarge('The uploaded file is too large.');
    return AppError.badRequest('Invalid upload.', undefined, 'UPLOAD_ERROR');
  }
  return null;
}

// Express identifies error middleware by its 4-argument signature.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const known = normalize(err);

  if (!known) {
    // Full details are logged server-side only; clients never see stacks or file paths.
    console.error(`[error] ${req.method} ${req.path}`, err);
    if (res.headersSent) return res.end();
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
  }

  if (known.status >= 500 && known.status !== 504) console.warn(`[error] ${req.method} ${req.path} -> ${known.code}`);
  if (res.headersSent) return res.end();

  const body = { code: known.code, message: known.message };
  if (known.details !== undefined) body.details = known.details;
  return res.status(known.status).json({ error: body });
}
