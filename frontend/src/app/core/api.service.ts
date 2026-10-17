import { HttpClient, HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import {
  AskRequest,
  AskResponse,
  ChunkDto,
  DocumentDto,
  HealthDto,
  ModelsResponse,
  SettingsDto,
} from './models';

/** The only place that talks to the network. Angular never calls Ollama directly; everything goes through /api. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  health(): Observable<HealthDto> {
    return this.http.get<HealthDto>(`${this.base}/health`);
  }

  models(): Observable<ModelsResponse> {
    return this.http.get<ModelsResponse>(`${this.base}/models`);
  }

  settings(): Observable<SettingsDto> {
    return this.http.get<SettingsDto>(`${this.base}/settings`);
  }

  listDocuments(): Observable<DocumentDto[]> {
    return this.http.get<{ documents: DocumentDto[] }>(`${this.base}/documents`).pipe(map((r) => r.documents));
  }

  uploadDocument(file: File): Observable<HttpEvent<{ document: DocumentDto }>> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<{ document: DocumentDto }>(`${this.base}/documents`, form, {
      reportProgress: true,
      observe: 'events',
    });
  }

  deleteDocument(id: string): Observable<{ deleted: boolean; id: string }> {
    return this.http.delete<{ deleted: boolean; id: string }>(`${this.base}/documents/${id}`);
  }

  retryDocument(id: string): Observable<DocumentDto> {
    return this.http.post<{ document: DocumentDto }>(`${this.base}/documents/${id}/retry`, {}).pipe(map((r) => r.document));
  }

  listChunks(id: string, offset: number, limit: number): Observable<{ total: number; chunks: ChunkDto[] }> {
    return this.http.get<{ total: number; chunks: ChunkDto[] }>(`${this.base}/documents/${id}/chunks`, {
      params: { offset, limit },
    });
  }

  ask(body: AskRequest): Observable<AskResponse> {
    return this.http.post<AskResponse>(`${this.base}/chat/ask`, body);
  }
}
