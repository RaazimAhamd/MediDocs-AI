import multer from 'multer';
import { AppError } from '../errors.js';
import { validateUploadMeta } from '../utils/validation.js';

/**
 * Multipart upload handler for a single "file" field.
 * Files are kept in memory (size-limited) and written by DocumentService to a random UUID name,
 * so no temporary file is ever renamed across drives and client file names never touch the filesystem.
 */
export function createUploadMiddleware(config) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5, parts: 8 },
    fileFilter(_req, file, cb) {
      try {
        validateUploadMeta({ originalName: file.originalname, mimeType: file.mimetype });
        cb(null, true);
      } catch (err) {
        cb(err);
      }
    },
  }).single('file');

  const maxMb = +(config.maxUploadBytes / (1024 * 1024)).toFixed(2);
  return (req, res, next) => {
    upload(req, res, (err) => {
      if (!err) return next();
      if (err?.name === 'MulterError') {
        if (err.code === 'LIMIT_FILE_SIZE') return next(AppError.payloadTooLarge(`The file is too large. The limit is ${maxMb} MB.`));
        if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(AppError.badRequest('Send exactly one file in the "file" field.', undefined, 'UNEXPECTED_FIELD'));
        return next(AppError.badRequest('The upload could not be read.', undefined, 'UPLOAD_ERROR'));
      }
      return next(err);
    });
  };
}
