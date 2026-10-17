import { z } from 'zod';
import { uuidSchema } from './validation.js';

/** Express 4 does not catch rejected promises from async handlers; forward them to next(). */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const parseId = (value) => uuidSchema.parse(value);
export const parseWith = (schema, value) => schema.parse(value);
export { z };
