import { HttpEventType } from '@angular/common/http';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentProviders, Provider } from '@angular/core';
import { provideRouter } from '@angular/router';
import { apiErrorInterceptor } from './core/api-error';
import { AskResponse, DocumentDto } from './core/models';

export { HttpEventType };

export const testProviders = (): (Provider | EnvironmentProviders)[] => [
  provideHttpClient(withInterceptors([apiErrorInterceptor])),
  provideHttpClientTesting(),
  provideRouter([]),
];

export function doc(over: Partial<DocumentDto> = {}): DocumentDto {
  return {
    id: 'd1',
    name: 'policy.pdf',
    extension: '.pdf',
    sizeBytes: 2048,
    uploadedAt: '2025-06-01T10:00:00.000Z',
    updatedAt: '2025-06-01T10:00:00.000Z',
    status: 'ready',
    stage: 'ready',
    progress: null,
    pageCount: 3,
    chunkCount: 4,
    characterCount: 3000,
    embedModel: 'nomic-embed-text:latest',
    error: null,
    ...over,
  };
}

export function answer(over: Partial<AskResponse> = {}): AskResponse {
  return {
    answer: 'Cancel at least 24 hours ahead [1].',
    grounded: true,
    reason: 'OK',
    model: 'gemma3:latest',
    sources: [
      { ref: 1, documentId: 'd1', documentName: 'policy.pdf', page: 2, chunkIndex: 2, score: 0.71, text: 'Appointments must be cancelled at least 24 hours in advance.', cited: true },
      { ref: 2, documentId: 'd1', documentName: 'policy.pdf', page: 1, chunkIndex: 0, score: 0.42, text: 'Reminders are sent 48 hours before.', cited: false },
    ],
    retrieval: { searchedChunks: 10, topK: 4, minSimilarity: 0.3, bestScore: 0.71 },
    timings: { retrievalMs: 120, generationMs: 4200 },
    disclaimer: 'AI-generated. Verify against the sources.',
    ...over,
  };
}
