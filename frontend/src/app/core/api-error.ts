import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function toApiError(err: HttpErrorResponse): ApiError {
  const body = (err.error as { error?: { code?: string; message?: string } } | null)?.error;
  if (!body?.code && (err.status === 0 || [502, 503, 504].includes(err.status))) {
    return new ApiError(
      0,
      'BACKEND_UNREACHABLE',
      'Cannot reach the MediDocs backend. Start it with start.bat (or "npm start" in the backend folder).',
    );
  }
  return new ApiError(err.status, body?.code ?? 'HTTP_ERROR', body?.message ?? `Request failed (HTTP ${err.status}).`);
}

/** Turns every HTTP failure into an ApiError with a user-readable message. */
export const apiErrorInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((err: unknown) =>
      throwError(() => (err instanceof HttpErrorResponse ? toApiError(err) : err)),
    ),
  );

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
