import { HttpErrorResponse } from '@angular/common/http';
import { ApiError, toApiError } from './api-error';

const err = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

describe('toApiError', () => {
  it('maps a network failure to a "backend not running" message', () => {
    const e = toApiError(err(0, new ProgressEvent('error')));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('BACKEND_UNREACHABLE');
    expect(e.message).toMatch(/start.bat/);
  });

  it('treats a dev-proxy failure (502/504 without a JSON body) as backend unreachable', () => {
    expect(toApiError(err(504, 'Error occurred while trying to proxy')).code).toBe('BACKEND_UNREACHABLE');
  });

  it('keeps the backend error code and message for real API errors, including 503/504 from Ollama', () => {
    const e = toApiError(err(503, { error: { code: 'OLLAMA_UNAVAILABLE', message: 'Cannot reach Ollama.' } }));
    expect(e.code).toBe('OLLAMA_UNAVAILABLE');
    expect(e.message).toBe('Cannot reach Ollama.');
    expect(e.status).toBe(503);
    expect(toApiError(err(504, { error: { code: 'OLLAMA_TIMEOUT', message: 'Too slow.' } })).code).toBe('OLLAMA_TIMEOUT');
  });

  it('falls back to a generic message', () => {
    const e = toApiError(err(500, null));
    expect(e.code).toBe('HTTP_ERROR');
    expect(e.message).toContain('500');
  });
});
