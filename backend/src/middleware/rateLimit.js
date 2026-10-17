import rateLimit from 'express-rate-limit';
import { AppError } from '../errors.js';

export function createRateLimiter({ limit, windowMs = 60_000, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(AppError.tooManyRequests(message)),
  });
}
