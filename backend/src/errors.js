/** Application error with an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details, code = 'BAD_REQUEST') {
    return new AppError(400, code, message, details);
  }
  static notFound(message = 'Resource not found.', code = 'NOT_FOUND') {
    return new AppError(404, code, message);
  }
  static conflict(message, code = 'CONFLICT') {
    return new AppError(409, code, message);
  }
  static payloadTooLarge(message = 'Payload too large.') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', message);
  }
  static unsupportedMediaType(message = 'Unsupported file type.', code = 'UNSUPPORTED_MEDIA_TYPE') {
    return new AppError(415, code, message);
  }
  static unprocessable(message, code = 'UNPROCESSABLE') {
    return new AppError(422, code, message);
  }
  static tooManyRequests(message = 'Too many requests. Please slow down.') {
    return new AppError(429, 'RATE_LIMITED', message);
  }
  static clientClosed(message = 'Request cancelled by the client.') {
    return new AppError(499, 'CLIENT_CANCELLED', message);
  }
  static badGateway(message, code = 'OLLAMA_ERROR') {
    return new AppError(502, code, message);
  }
  static serviceUnavailable(message, code = 'OLLAMA_UNAVAILABLE') {
    return new AppError(503, code, message);
  }
  static gatewayTimeout(message, code = 'OLLAMA_TIMEOUT') {
    return new AppError(504, code, message);
  }
}

/** Message safe to store/show for any thrown value. */
export function publicErrorInfo(err) {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  return { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' };
}
