import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { HealthStore } from './core/health.store';
import { doc, testProviders } from './testing';

describe('App shell', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [App], providers: testProviders() });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    TestBed.inject(HealthStore).stop();
  });

  it('renders the navigation and reflects Ollama status from the health endpoint', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    http.expectOne('/api/health').flush({
      status: 'ok', app: 'MediDocs AI', mode: 'local-portfolio-demo', time: '', uptimeSeconds: 3,
      ollama: { reachable: true, ready: true, version: '0.9.0' },
    });
    http.expectOne('/api/settings').flush({ maxUploadMb: 10, allowedExtensions: ['.pdf', '.txt'], chunkSize: 1000, chunkOverlap: 150, topK: 4, minSimilarity: 0.3, defaultModel: 'gemma3:latest', embedModel: 'nomic-embed-text:latest' });
    http.expectOne('/api/models').flush({ defaultModel: 'gemma3:latest', embedModel: 'nomic-embed-text:latest', models: [{ name: 'gemma3:latest', sizeBytes: 1, modifiedAt: null }] });
    http.expectOne('/api/documents').flush({ documents: [doc()] });
    await new Promise((resolve) => setTimeout(resolve, 0)); // whenStable() never settles with the health-check interval running
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(Array.from(el.querySelectorAll('nav a')).map((a) => a.textContent?.trim())).toEqual(['Dashboard', 'Documents', 'Ask questions', 'Settings']);
    expect(el.querySelector('.status')?.textContent).toContain('Assistant ready');
    expect(el.textContent).toContain('Not medical advice');
  });

  it('reports a stopped backend', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    http.expectOne('/api/health').error(new ProgressEvent('error'));
    http.expectOne('/api/settings').error(new ProgressEvent('error'));
    http.expectOne('/api/models').error(new ProgressEvent('error'));
    http.expectOne('/api/documents').error(new ProgressEvent('error'));
    await new Promise((resolve) => setTimeout(resolve, 0)); // whenStable() never settles with the health-check interval running
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.status')?.textContent).toContain('Backend not running');
  });
});
