import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DocumentsStore } from '../../core/documents.store';
import { HealthStore } from '../../core/health.store';
import { SettingsStore } from '../../core/settings.store';
import { answer, doc, testProviders } from '../../testing';
import { ChatComponent } from './chat';

describe('ChatComponent', () => {
  let fixture: ComponentFixture<ChatComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel);
  const qa = <T extends HTMLElement>(sel: string) => Array.from(el.querySelectorAll<T>(sel));
  // whenStable() would wait forever while an HTTP request is pending, so just flush microtasks/timers.
  const settle = async () => {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [ChatComponent], providers: testProviders() });
    http = TestBed.inject(HttpTestingController);

    const docs = TestBed.inject(DocumentsStore);
    docs.documents.set([doc()]);
    docs.loaded.set(true);
    const settings = TestBed.inject(SettingsStore);
    settings.models.set([
      { name: 'gemma3:latest', sizeBytes: 3_300_000_000, modifiedAt: null },
      { name: 'llama3:latest', sizeBytes: 4_700_000_000, modifiedAt: null },
    ]);
    settings.defaultModel.set('gemma3:latest');
    TestBed.inject(HealthStore).health.set({
      status: 'ok', app: 'MediDocs AI', mode: 'local-portfolio-demo', time: '', uptimeSeconds: 1,
      ollama: { reachable: true, ready: true, version: '0.9.0' },
    });

    fixture = TestBed.createComponent(ChatComponent);
    el = fixture.nativeElement as HTMLElement;
    await settle();
  });
  afterEach(() => http.verify());

  it('shows suggested questions and the model list from installed models', () => {
    expect(qa('.chip')).toHaveLength(6);
    expect(qa('#model option').map((o) => o.textContent?.trim())).toEqual(['gemma3:latest', 'llama3:latest']);
    expect(qa('#scope option').map((o) => o.textContent?.trim())).toEqual(['All ready documents', 'policy.pdf']);
  });

  it('asks a suggested question and renders the answer, citation chip and expandable source', async () => {
    qa<HTMLButtonElement>('.chip')[1].click();
    await settle();
    expect(q('.wait')?.textContent).toContain('Searching your documents');

    const req = http.expectOne('/api/chat/ask');
    expect(req.request.body.model).toBe('gemma3:latest');
    expect(req.request.body.question).toMatch(/MRI/);
    req.flush(answer());
    await settle();

    expect(q('.answer .md')?.textContent).toContain('Cancel at least 24 hours ahead');
    const chip = q<HTMLElement>('sup.cite');
    expect(chip?.dataset['cite']).toBe('1');
    expect(q('.sources h4')?.textContent).toBe('Sources (2)');
    expect(q('.passage')).toBeNull();

    chip!.click(); // clicking the citation opens the cited passage
    await settle();
    expect(q('.passage')?.textContent).toContain('at least 24 hours in advance');
    expect(q('.sources li.open .doc')?.textContent).toBe('policy.pdf');
    expect(q('.sources li.open .where')?.textContent).toBe('page 2');
    expect(qa('.sources .ref.cited')).toHaveLength(1);
  });

  it('sends the typed question with Enter and keeps Shift+Enter for new lines', async () => {
    const box = q<HTMLTextAreaElement>('textarea')!;
    const send = qa<HTMLButtonElement>('.composer .btn.primary')[0];
    expect(send.disabled).toBe(true);

    box.value = 'What are the ICU visiting hours?';
    box.dispatchEvent(new Event('input'));
    await settle();
    expect(send.disabled).toBe(false);

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    http.expectNone('/api/chat/ask');

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    http.expectOne('/api/chat/ask').flush(answer({ answer: 'ICU visiting is 14:00 to 16:00 [1].' }));
    await settle();
    expect(box.value).toBe('');
    expect(qa('.msg.user .bubble')[0].textContent).toBe('What are the ICU visiting hours?');
  });

  it('scopes the question to the selected document', async () => {
    const select = q<HTMLSelectElement>('#scope')!;
    select.value = 'd1';
    select.dispatchEvent(new Event('change'));
    await settle();
    qa<HTMLButtonElement>('.chip')[0].click();
    expect(http.expectOne('/api/chat/ask').request.body.documentIds).toEqual(['d1']);
  });

  it('shows a friendly error with a hint and lets the user ask again', async () => {
    qa<HTMLButtonElement>('.chip')[0].click();
    http.expectOne('/api/chat/ask').flush(
      { error: { code: 'OLLAMA_UNAVAILABLE', message: 'Cannot reach Ollama. Make sure it is installed and running.' } },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await settle();
    expect(q('.fail')?.textContent).toContain('Cannot reach Ollama');
    expect(q('.fail .hint')?.textContent).toContain('ollama serve');

    q<HTMLButtonElement>('.fail .btn')!.click();
    http.expectOne('/api/chat/ask').flush(answer());
    await settle();
    expect(q('.fail')).toBeNull();
    expect(q('.answer')).not.toBeNull();
  });

  it('can cancel a slow question', async () => {
    qa<HTMLButtonElement>('.chip')[0].click();
    await settle();
    const req = http.expectOne('/api/chat/ask');
    q<HTMLButtonElement>('.wait .btn')!.click();
    await settle();
    expect(req.cancelled).toBe(true);
    expect(q('.fail')?.textContent).toContain('You cancelled this question');
  });

  it('labels answers that are not supported by the documents', async () => {
    qa<HTMLButtonElement>('.chip')[0].click();
    http.expectOne('/api/chat/ask').flush(
      answer({ answer: 'The available documents do not contain enough information to answer this question.', grounded: false, reason: 'MODEL_INSUFFICIENT' }),
    );
    await settle();
    expect(q('.answer.weak')).not.toBeNull();
    expect(q('.sources h4')?.textContent).toContain('not enough to answer');
  });

  it('warns when the model did not cite sources', async () => {
    qa<HTMLButtonElement>('.chip')[0].click();
    http.expectOne('/api/chat/ask').flush(answer({ answer: 'Probably 24 hours.', reason: 'NO_CITATIONS' }));
    await settle();
    expect(q('.note.warn')?.textContent).toContain('did not cite any source');
  });

  it('never executes HTML coming back from the model', async () => {
    qa<HTMLButtonElement>('.chip')[0].click();
    http.expectOne('/api/chat/ask').flush(
      answer({ answer: 'Hello <img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> **bold** [1]' }),
    );
    await settle();
    const md = q('.answer .md')!;
    expect(md.querySelector('img, script')).toBeNull();
    expect(md.querySelector('strong')?.textContent).toBe('bold');
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it('shows banners when the backend or Ollama is unavailable', async () => {
    const health = TestBed.inject(HealthStore);
    health.health.set({
      status: 'ok', app: 'MediDocs AI', mode: 'local-portfolio-demo', time: '', uptimeSeconds: 1,
      ollama: { reachable: false, ready: false, code: 'OLLAMA_UNAVAILABLE', message: 'Cannot reach Ollama.' },
    });
    await settle();
    expect(q('.banner.warn')?.textContent).toContain('Ollama is not running');

    health.backendError.set('Cannot reach the MediDocs backend.');
    await settle();
    expect(q('.banner.error')?.textContent).toContain('backend is not running');
  });

  it('clears the conversation after confirmation', async () => {
    qa<HTMLButtonElement>('.chip')[0].click();
    http.expectOne('/api/chat/ask').flush(answer());
    await settle();
    expect(qa('.msg')).toHaveLength(2);

    const clearBtn = qa<HTMLButtonElement>('.controls .btn').find((b) => b.textContent?.includes('Clear'))!;
    clearBtn.click();
    await settle();
    q<HTMLButtonElement>('app-confirm-dialog .btn.danger')!.click();
    await settle();
    expect(qa('.msg')).toHaveLength(0);
    expect(qa('.chip')).toHaveLength(6);
  });
});
