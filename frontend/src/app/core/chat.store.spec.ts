import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { answer, testProviders } from '../testing';
import { ChatStore } from './chat.store';

describe('ChatStore', () => {
  let chat: ChatStore;
  let http: HttpTestingController;

  const setup = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: testProviders() });
    chat = TestBed.inject(ChatStore);
    http = TestBed.inject(HttpTestingController);
  };

  beforeEach(() => {
    localStorage.clear();
    setup();
  });
  afterEach(() => http.verify());

  it('asks a question, stores the grounded answer with sources, and persists it', () => {
    expect(chat.ask('How early must I cancel?', { model: 'gemma3:latest' })).toBe(true);
    expect(chat.sending()).toBe(true);
    expect(chat.messages().map((m) => m.status)).toEqual(['done', 'pending']);

    const req = http.expectOne('/api/chat/ask');
    expect(req.request.body).toEqual({ question: 'How early must I cancel?', model: 'gemma3:latest' });
    req.flush(answer());

    const [user, bot] = chat.messages();
    expect(user.content).toBe('How early must I cancel?');
    expect(bot.status).toBe('done');
    expect(bot.response?.sources[0]).toMatchObject({ documentName: 'policy.pdf', page: 2, cited: true });
    expect(chat.sending()).toBe(false);
    expect(chat.active()?.title).toBe('How early must I cancel?');
    expect(JSON.parse(localStorage.getItem('medidocs.conversations.v1')!)[0].messages).toHaveLength(2);
  });

  it('sends the document scope only when one is selected', () => {
    chat.ask('Question about one doc', { documentIds: ['d1'] });
    expect(http.expectOne('/api/chat/ask').request.body).toEqual({ question: 'Question about one doc', documentIds: ['d1'] });
  });

  it('ignores empty, over-long and concurrent questions', () => {
    expect(chat.ask('   ')).toBe(false);
    expect(chat.ask('x'.repeat(1001))).toBe(false);
    http.expectNone('/api/chat/ask');
    expect(chat.ask('First question here')).toBe(true);
    expect(chat.ask('Second question here')).toBe(false);
    http.expectOne('/api/chat/ask').flush(answer());
  });

  it('turns API failures into a readable error message with its code', () => {
    chat.ask('Will this work offline?');
    http.expectOne('/api/chat/ask').flush(
      { error: { code: 'OLLAMA_UNAVAILABLE', message: 'Cannot reach Ollama. Make sure it is running.' } },
      { status: 503, statusText: 'Service Unavailable' },
    );
    const bot = chat.messages()[1];
    expect(bot.status).toBe('error');
    expect(bot.errorCode).toBe('OLLAMA_UNAVAILABLE');
    expect(bot.errorMessage).toContain('Cannot reach Ollama');
    expect(chat.sending()).toBe(false);
  });

  it('reports a missing model with the server-provided instructions', () => {
    chat.ask('Which model is missing?');
    http.expectOne('/api/chat/ask').flush(
      { error: { code: 'MODEL_NOT_FOUND', message: 'The chat model "llama3:latest" is not installed. Run: ollama pull llama3:latest' } },
      { status: 502, statusText: 'Bad Gateway' },
    );
    expect(chat.messages()[1].errorMessage).toContain('ollama pull llama3:latest');
  });

  it('cancels a pending question and aborts the HTTP request', () => {
    chat.ask('A slow question');
    const req = http.expectOne('/api/chat/ask');
    chat.cancel();
    expect(req.cancelled).toBe(true);
    expect(chat.sending()).toBe(false);
    expect(chat.messages()[1]).toMatchObject({ status: 'error', errorCode: 'CANCELLED' });
  });

  it('retries a failed question by replacing the failed pair', () => {
    chat.ask('Retry me please');
    http.expectOne('/api/chat/ask').flush({ error: { code: 'OLLAMA_TIMEOUT', message: 'slow' } }, { status: 504, statusText: 'Gateway Timeout' });
    const failed = chat.messages()[1];
    expect(chat.retry(failed.id)).toBe(true);
    http.expectOne('/api/chat/ask').flush(answer());
    expect(chat.messages()).toHaveLength(2);
    expect(chat.messages()[1].status).toBe('done');
  });

  it('manages conversations: new, switch, clear, delete', () => {
    chat.ask('First topic here');
    http.expectOne('/api/chat/ask').flush(answer());
    const first = chat.activeId()!;

    chat.newConversation();
    const second = chat.activeId()!;
    expect(second).not.toBe(first);
    chat.newConversation(); // an empty conversation is reused
    expect(chat.conversations()).toHaveLength(2);

    chat.select(first);
    expect(chat.messages()).toHaveLength(2);
    chat.clearActive();
    expect(chat.messages()).toHaveLength(0);
    expect(chat.active()?.title).toBe('New conversation');

    chat.deleteConversation(first);
    expect(chat.conversations().map((c) => c.id)).toEqual([second]);
    expect(chat.activeId()).toBe(second);
  });

  it('restores conversations after a reload and ignores corrupt storage', () => {
    chat.ask('Persist this question');
    http.expectOne('/api/chat/ask').flush(answer());
    setup();
    expect(chat.conversations()[0].messages[0].content).toBe('Persist this question');
    expect(chat.activeId()).toBe(chat.conversations()[0].id);

    localStorage.setItem('medidocs.conversations.v1', '{not json');
    setup();
    expect(chat.conversations()).toEqual([]);
  });

  it('lists recent questions newest first', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T10:00:00Z'));
    chat.ask('Older question here');
    http.expectOne('/api/chat/ask').flush(answer());
    vi.setSystemTime(new Date('2025-06-01T11:00:00Z'));
    chat.ask('Newer question here');
    http.expectOne('/api/chat/ask').flush(answer());
    vi.useRealTimers();
    expect(chat.recentQuestions().map((q) => q.text)).toEqual(['Newer question here', 'Older question here']);
  });
});
