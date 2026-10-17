import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { doc, HttpEventType, testProviders } from '../testing';
import { DocumentsStore } from './documents.store';
import { ToastService } from './toast.service';

const file = (name: string, size = 100, type = 'text/plain') => new File([new Uint8Array(size)], name, { type });

describe('DocumentsStore', () => {
  let store: DocumentsStore;
  let http: HttpTestingController;
  let toast: ToastService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: testProviders() });
    store = TestBed.inject(DocumentsStore);
    http = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(ToastService);
  });
  afterEach(() => {
    store.stop();
    vi.useRealTimers();
    http.verify();
  });

  it('loads documents and computes totals', () => {
    store.load();
    http.expectOne('/api/documents').flush({
      documents: [doc({ id: 'a', chunkCount: 4, sizeBytes: 1000 }), doc({ id: 'b', status: 'failed', chunkCount: 0, sizeBytes: 500 })],
    });
    expect(store.loaded()).toBe(true);
    expect(store.totals()).toEqual({ documents: 2, ready: 1, failed: 1, chunks: 4, bytes: 1500 });
    expect(store.readyDocuments().map((d) => d.id)).toEqual(['a']);
  });

  it('shows a readable error when the backend is down', () => {
    store.load();
    http.expectOne('/api/documents').error(new ProgressEvent('error'));
    expect(store.error()).toMatch(/Cannot reach the MediDocs backend/);
    expect(store.loaded()).toBe(true);
  });

  it('rejects unsupported, empty and oversized files before uploading', () => {
    expect(store.validateFile(file('virus.exe'))).toMatch(/not supported/);
    expect(store.validateFile(file('noext'))).toMatch(/not supported/);
    expect(store.validateFile(file('empty.txt', 0))).toMatch(/empty/);
    expect(store.validateFile(file('big.pdf', 11 * 1024 * 1024, 'application/pdf'))).toMatch(/limit/);
    expect(store.validateFile(file('Good.PDF', 10, 'application/pdf'))).toBeNull();
    expect(store.validateFile(file('notes.txt'))).toBeNull();
  });

  it('does not call the API for an invalid file and tells the user', () => {
    store.upload(file('virus.exe'));
    http.expectNone('/api/documents');
    expect(toast.toasts()[0].kind).toBe('error');
    expect(store.uploads()).toEqual([]);
  });

  it('uploads with progress, adds the document, then polls until it is ready', () => {
    vi.useFakeTimers();
    store.upload(file('visitors.txt'));
    expect(store.uploads()).toHaveLength(1);

    const req = http.expectOne('/api/documents');
    expect(req.request.method).toBe('POST');
    expect((req.request.body as FormData).get('file')).toBeInstanceOf(File);
    req.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    expect(store.uploads()[0].progress).toBe(50);

    req.flush({ document: doc({ id: 'n1', name: 'visitors.txt', status: 'queued', stage: 'queued', chunkCount: 0 }) });
    expect(store.uploads()).toEqual([]);
    expect(store.documents()[0].name).toBe('visitors.txt');
    expect(store.activeCount()).toBe(1);

    vi.advanceTimersByTime(1500);
    http.expectOne('/api/documents').flush({ documents: [doc({ id: 'n1', status: 'processing', stage: 'embedding', progress: { done: 2, total: 5 } })] });
    expect(store.documents()[0].progress?.done).toBe(2);

    vi.advanceTimersByTime(1500);
    http.expectOne('/api/documents').flush({ documents: [doc({ id: 'n1', status: 'ready' })] });

    vi.advanceTimersByTime(10_000); // everything is ready: polling must stop
    http.expectNone('/api/documents');
  });

  it('keeps a failed upload visible with the server message', () => {
    store.upload(file('a.txt'));
    http.expectOne('/api/documents').flush(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: 'The file is too large.' } },
      { status: 413, statusText: 'Payload Too Large' },
    );
    expect(store.uploads()[0]).toMatchObject({ state: 'error', error: 'The file is too large.' });
    store.dismissUpload(store.uploads()[0].key);
    expect(store.uploads()).toEqual([]);
  });

  it('deletes a document', () => {
    store.documents.set([doc({ id: 'a' }), doc({ id: 'b', name: 'b.txt' })]);
    store.remove(store.documents()[0]);
    const req = http.expectOne('/api/documents/a');
    expect(req.request.method).toBe('DELETE');
    req.flush({ deleted: true, id: 'a' });
    expect(store.documents().map((d) => d.id)).toEqual(['b']);
    expect(toast.toasts().at(-1)?.kind).toBe('success');
  });

  it('retries a failed document', () => {
    vi.useFakeTimers();
    store.documents.set([doc({ id: 'a', status: 'failed', error: { code: 'OLLAMA_UNAVAILABLE', message: 'x' } })]);
    store.retry(store.documents()[0]);
    http.expectOne('/api/documents/a/retry').flush({ document: doc({ id: 'a', status: 'queued' }) });
    expect(store.documents()[0].status).toBe('queued');
  });
});
