import path from 'node:path';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { sanitizeDisplayName } from './text.js';

export const ALLOWED_UPLOADS = Object.freeze({
  '.pdf': { label: 'PDF', mimes: ['application/pdf', 'application/x-pdf'] },
  '.txt': { label: 'TXT', mimes: ['text/plain'] },
});

// Some Windows setups report no/unknown MIME type; the content check below must still pass.
const GENERIC_MIMES = ['', 'application/octet-stream'];

export function normalizeMime(mime) {
  return String(mime ?? '').split(';')[0].trim().toLowerCase();
}

/** Checks file name and declared MIME type. Returns the safe extension and display name. */
export function validateUploadMeta({ originalName, mimeType }) {
  const displayName = sanitizeDisplayName(originalName);
  const extension = path.extname(displayName).toLowerCase();
  const rule = ALLOWED_UPLOADS[extension];
  if (!rule) {
    throw AppError.unsupportedMediaType('Only PDF and TXT files can be uploaded.', 'UNSUPPORTED_EXTENSION');
  }
  const mime = normalizeMime(mimeType);
  if (!rule.mimes.includes(mime) && !GENERIC_MIMES.includes(mime)) {
    throw AppError.unsupportedMediaType(
      `The file type "${mime}" does not match a ${rule.label} file.`,
      'MIME_MISMATCH',
    );
  }
  return { extension, displayName };
}

/** Checks the actual bytes (magic number for PDF, plain-text sanity for TXT). */
export function validateUploadContent({ buffer, extension }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw AppError.badRequest('The uploaded file is empty.', undefined, 'EMPTY_FILE');
  }
  if (extension === '.pdf') {
    const head = buffer.subarray(0, 1024).toString('latin1');
    if (!head.includes('%PDF-')) {
      throw AppError.unsupportedMediaType('This file is not a valid PDF.', 'INVALID_PDF_SIGNATURE');
    }
    return;
  }
  if (extension === '.txt') {
    if (buffer.subarray(0, 8192).includes(0)) {
      throw AppError.unsupportedMediaType('This file looks binary, not plain text.', 'INVALID_TEXT_FILE');
    }
    if (buffer.toString('utf8').trim().length === 0) {
      throw AppError.unprocessable('The text file contains no readable text.', 'EMPTY_DOCUMENT');
    }
  }
}

export const uuidSchema = z.string().uuid();

export const askSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(3, 'Please enter a longer question.')
      .max(1000, 'Question is too long (max 1000 characters).'),
    model: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, 'Invalid model name.')
      .optional(),
    documentIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .strict();

export const chunkListQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const chunkIndexSchema = z.coerce.number().int().min(0);
