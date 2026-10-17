import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DocumentsStore } from '../../core/documents.store';
import { ToastService } from '../../core/toast.service';
import { doc, testProviders } from '../../testing';
import { DocumentsComponent } from './documents';

describe('DocumentsComponent', () => {
  let fixture: ComponentFixture<DocumentsComponent>;
  let http: HttpTestingController;
  let store: DocumentsStore;
  let el: HTMLElement;

  const qa = <T extends HTMLElement>(sel: string) => Array.from(el.querySelectorAll<T>(sel));
  // whenStable() would wait forever while an HTTP request is pending, so just flush microtasks/timers.
  const settle = async () => {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [DocumentsComponent], providers: testProviders() });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(DocumentsStore);
    fixture = TestBed.createComponent(DocumentsComponent);
    el = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => {
    store.stop();
    http.verify();
  });

  it('shows skeletons while loading, then an empty state', async () => {
    await settle();
    expect(qa('.skeleton').length).toBeGreaterThan(0);
    store.loaded.set(true);
    await settle();
    expect(el.querySelector('.empty h3')?.textContent).toBe('Your library is empty');
  });

  it('lists documents with size, pages, passages and status', async () => {
    store.documents.set([
      doc({ id: 'a', name: 'Appointment policy.pdf', status: 'ready' }),
      doc({ id: 'b', name: 'broken.pdf', status: 'failed', chunkCount: 0, pageCount: null, error: { code: 'PDF_INVALID', message: 'This PDF could not be read. It may be damaged or malformed.' } }),
      doc({ id: 'c', name: 'new.txt', status: 'processing', stage: 'embedding', progress: { done: 3, total: 6 }, chunkCount: 0 }),
    ]);
    store.loaded.set(true);
    await settle();

    const rows = qa('.tr:not(.th)');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Appointment policy.pdf');
    expect(rows[0].textContent).toContain('2.0 KB');
    expect(rows[0].querySelector('.pill')?.textContent).toBe('Ready');
    expect(rows[1].querySelector('.fail')?.textContent).toContain('damaged or malformed');
    expect(rows[1].textContent).toContain('Retry');
    expect(rows[2].querySelector('.pill')?.textContent).toBe('Indexing 3/6');
    expect(rows[2].querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('50');
  });

  it('deletes a document only after confirmation', async () => {
    store.documents.set([doc({ id: 'a', name: 'old.pdf' })]);
    store.loaded.set(true);
    await settle();

    el.querySelector<HTMLButtonElement>('[aria-label="Delete old.pdf"]')!.click();
    await settle();
    expect(el.querySelector('app-confirm-dialog')?.textContent).toContain('permanently removed');

    el.querySelector<HTMLButtonElement>('app-confirm-dialog .btn:not(.danger)')!.click(); // cancel
    await settle();
    http.expectNone('/api/documents/a');

    el.querySelector<HTMLButtonElement>('[aria-label="Delete old.pdf"]')!.click();
    await settle();
    el.querySelector<HTMLButtonElement>('app-confirm-dialog .btn.danger')!.click();
    http.expectOne('/api/documents/a').flush({ deleted: true, id: 'a' });
    await settle();
    expect(qa('.tr:not(.th)')).toHaveLength(0);
  });

  it('rejects a wrong file type from the file picker with a toast and no request', async () => {
    store.loaded.set(true);
    await settle();
    const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
    const bad = new File(['x'], 'macro.exe', { type: 'application/octet-stream' });
    Object.defineProperty(input, 'files', { value: [bad], configurable: true });
    input.dispatchEvent(new Event('change'));
    http.expectNone('/api/documents');
    expect(TestBed.inject(ToastService).toasts()[0].message).toContain('not supported');
  });

  it('uploads dropped files and shows progress', async () => {
    store.loaded.set(true);
    await settle();
    const drop = el.querySelector<HTMLElement>('.drop')!;
    const file = new File(['hello policy'], 'notes.txt', { type: 'text/plain' });
    const event = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    event.dataTransfer = { files: [file] };
    drop.dispatchEvent(event);
    await settle();
    expect(el.querySelector('.uploads')?.textContent).toContain('notes.txt');
    http.expectOne('/api/documents').flush({ document: doc({ id: 'n', name: 'notes.txt', status: 'queued', chunkCount: 0 }) }, { status: 202, statusText: 'Accepted' });
    await settle();
    expect(el.querySelector('.uploads')).toBeNull();
    expect(qa('.tr:not(.th)')[0].textContent).toContain('notes.txt');
  });

  it('shows the stored passages of a ready document', async () => {
    store.documents.set([doc({ id: 'a', name: 'p.pdf' })]);
    store.loaded.set(true);
    await settle();
    el.querySelector<HTMLButtonElement>('.actions .btn.quiet')!.click();
    http.expectOne((r) => r.url === '/api/documents/a/chunks').flush({
      total: 1,
      chunks: [{ index: 0, page: 2, text: 'Late cancellation fees apply.' }],
    });
    await settle();
    expect(el.querySelector('.passages')?.textContent).toContain('Page 2');
    expect(el.querySelector('.passages p')?.textContent).toBe('Late cancellation fees apply.');
  });
});
