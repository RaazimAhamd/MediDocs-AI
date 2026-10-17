import { HttpEventType } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { ApiError, errorMessage } from './api-error';
import { formatBytes, uid } from './format';
import { DocumentDto } from './models';
import { SettingsStore } from './settings.store';
import { ToastService } from './toast.service';

export interface UploadItem {
  key: string;
  name: string;
  progress: number;
  state: 'uploading' | 'error';
  error?: string;
}

const ALLOWED = ['.pdf', '.txt'];

@Injectable({ providedIn: 'root' })
export class DocumentsStore {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly settings = inject(SettingsStore);
  private pollHandle?: ReturnType<typeof setTimeout>;

  readonly documents = signal<DocumentDto[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly uploads = signal<UploadItem[]>([]);

  readonly readyDocuments = computed(() => this.documents().filter((d) => d.status === 'ready'));
  readonly activeCount = computed(
    () => this.documents().filter((d) => d.status === 'queued' || d.status === 'processing').length,
  );
  readonly totals = computed(() => {
    const docs = this.documents();
    return {
      documents: docs.length,
      ready: docs.filter((d) => d.status === 'ready').length,
      failed: docs.filter((d) => d.status === 'failed').length,
      chunks: docs.reduce((n, d) => n + d.chunkCount, 0),
      bytes: docs.reduce((n, d) => n + d.sizeBytes, 0),
    };
  });

  load(silent = false): void {
    if (!silent) this.loading.set(true);
    this.api.listDocuments().subscribe({
      next: (docs) => {
        this.documents.set(docs);
        this.error.set(null);
        this.loading.set(false);
        this.loaded.set(true);
        this.schedulePoll();
      },
      error: (e: ApiError) => {
        this.error.set(e.message);
        this.loading.set(false);
        this.loaded.set(true);
        this.schedulePoll();
      },
    });
  }

  /** Returns an error message if the file should not be uploaded, otherwise null. */
  validateFile(file: File): string | null {
    const dot = file.name.lastIndexOf('.');
    const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
    if (!ALLOWED.includes(ext)) return `"${file.name}" is not supported. Upload a PDF or TXT file.`;
    if (file.size === 0) return `"${file.name}" is empty.`;
    const max = this.settings.maxUploadBytes();
    if (file.size > max) return `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(max)}.`;
    return null;
  }

  upload(file: File): void {
    const problem = this.validateFile(file);
    if (problem) {
      this.toast.error(problem);
      return;
    }
    const key = uid();
    this.uploads.update((list) => [...list, { key, name: file.name, progress: 0, state: 'uploading' }]);
    const patch = (p: Partial<UploadItem>) =>
      this.uploads.update((list) => list.map((u) => (u.key === key ? { ...u, ...p } : u)));

    this.api.uploadDocument(file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          patch({ progress: Math.round((event.loaded / event.total) * 100) });
        } else if (event.type === HttpEventType.Response && event.body) {
          const doc = event.body.document;
          this.uploads.update((list) => list.filter((u) => u.key !== key));
          this.documents.update((docs) => [doc, ...docs.filter((d) => d.id !== doc.id)]);
          this.toast.info(`"${doc.name}" uploaded. Processing started.`);
          this.schedulePoll();
        }
      },
      error: (e: unknown) => {
        const message = errorMessage(e, 'Upload failed.');
        patch({ state: 'error', error: message });
        this.toast.error(message);
      },
    });
  }

  dismissUpload(key: string): void {
    this.uploads.update((list) => list.filter((u) => u.key !== key));
  }

  remove(doc: DocumentDto): void {
    this.api.deleteDocument(doc.id).subscribe({
      next: () => {
        this.documents.update((docs) => docs.filter((d) => d.id !== doc.id));
        this.toast.success(`"${doc.name}" and its passages were deleted.`);
      },
      error: (e: unknown) => this.toast.error(errorMessage(e, 'Could not delete the document.')),
    });
  }

  retry(doc: DocumentDto): void {
    this.api.retryDocument(doc.id).subscribe({
      next: (updated) => {
        this.documents.update((docs) => docs.map((d) => (d.id === updated.id ? updated : d)));
        this.toast.info(`Processing "${doc.name}" again.`);
        this.schedulePoll();
      },
      error: (e: unknown) => this.toast.error(errorMessage(e, 'Could not retry processing.')),
    });
  }

  stop(): void {
    clearTimeout(this.pollHandle);
    this.pollHandle = undefined;
  }

  /** Poll only while something is still being processed. */
  private schedulePoll(): void {
    this.stop();
    if (this.activeCount() > 0) this.pollHandle = setTimeout(() => this.load(true), 1500);
  }
}
