import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription, timeout } from 'rxjs';
import { ApiService } from './api.service';
import { ApiError } from './api-error';
import { uid } from './format';
import { MAX_QUESTION_LENGTH } from './limits';
import { AskResponse, ChatMessage, Conversation } from './models';

const KEY = 'medidocs.conversations.v1';
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES = 80;
const CLIENT_TIMEOUT_MS = 330_000;

export interface AskOptions {
  model?: string | null;
  documentIds?: string[];
}

@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly api = inject(ApiService);
  private subscription?: Subscription;

  readonly conversations = signal<Conversation[]>(this.restore());
  readonly activeId = signal<string | null>(null);
  readonly sending = signal(false);

  readonly active = computed(() => this.conversations().find((c) => c.id === this.activeId()) ?? null);
  readonly messages = computed(() => this.active()?.messages ?? []);

  readonly recentQuestions = computed(() =>
    this.conversations()
      .flatMap((c) =>
        c.messages.filter((m) => m.role === 'user').map((m) => ({ conversationId: c.id, text: m.content, createdAt: m.createdAt })),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6),
  );

  constructor() {
    const first = this.conversations()[0];
    if (first) this.activeId.set(first.id);
  }

  newConversation(): void {
    const current = this.active();
    if (current && current.messages.length === 0) return; // reuse the empty one
    const now = new Date().toISOString();
    const conv: Conversation = { id: uid(), title: 'New conversation', createdAt: now, updatedAt: now, messages: [] };
    this.conversations.update((list) => [conv, ...list].slice(0, MAX_CONVERSATIONS));
    this.activeId.set(conv.id);
    this.persist();
  }

  select(id: string): void {
    if (this.sending()) return;
    if (this.conversations().some((c) => c.id === id)) this.activeId.set(id);
  }

  deleteConversation(id: string): void {
    if (this.sending() && id === this.activeId()) this.cancel();
    this.conversations.update((list) => list.filter((c) => c.id !== id));
    if (this.activeId() === id) this.activeId.set(this.conversations()[0]?.id ?? null);
    this.persist();
  }

  clearActive(): void {
    const id = this.activeId();
    if (!id) return;
    if (this.sending()) this.cancel();
    this.patchConversation(id, (c) => ({ ...c, title: 'New conversation', messages: [] }));
  }

  clearAll(): void {
    this.cancel();
    this.conversations.set([]);
    this.activeId.set(null);
    this.persist();
  }

  ask(question: string, options: AskOptions = {}): boolean {
    const text = question.trim();
    if (!text || text.length > MAX_QUESTION_LENGTH || this.sending()) return false;

    if (!this.active()) this.newConversation();
    const convId = this.activeId() as string;
    const now = new Date().toISOString();
    const user: ChatMessage = { id: uid(), role: 'user', content: text, createdAt: now, status: 'done' };
    const pending: ChatMessage = { id: uid(), role: 'assistant', content: '', createdAt: now, status: 'pending' };

    this.patchConversation(convId, (c) => ({
      ...c,
      title: c.messages.length === 0 ? text.slice(0, 60) : c.title,
      messages: [...c.messages, user, pending].slice(-MAX_MESSAGES),
    }));
    this.sending.set(true);

    const settle = (patch: Partial<ChatMessage>) => {
      this.patchMessage(convId, pending.id, patch);
      this.sending.set(false);
      this.subscription = undefined;
    };

    this.subscription = this.api
      .ask({
        question: text,
        ...(options.model ? { model: options.model } : {}),
        ...(options.documentIds?.length ? { documentIds: options.documentIds } : {}),
      })
      .pipe(timeout({ first: CLIENT_TIMEOUT_MS }))
      .subscribe({
        next: (res: AskResponse) =>
          settle({
            status: 'done',
            content: res.answer,
            createdAt: new Date().toISOString(),
            response: {
              grounded: res.grounded,
              reason: res.reason,
              model: res.model,
              sources: res.sources,
              timings: res.timings,
              disclaimer: res.disclaimer,
            },
          }),
        error: (e: unknown) => {
          const isTimeout = e instanceof Error && e.name === 'TimeoutError';
          const api = e instanceof ApiError ? e : null;
          settle({
            status: 'error',
            content: '',
            errorCode: isTimeout ? 'CLIENT_TIMEOUT' : (api?.code ?? 'UNKNOWN'),
            errorMessage: isTimeout
              ? 'No answer arrived after 5 minutes. The local model may be overloaded. Try a smaller model or a shorter question.'
              : (api?.message ?? 'Something went wrong while asking the question.'),
          });
        },
      });
    return true;
  }

  /** Stops waiting for the answer; the backend aborts the Ollama call when the request is cancelled. */
  cancel(): void {
    if (!this.subscription) return;
    this.subscription.unsubscribe();
    this.subscription = undefined;
    const convId = this.activeId();
    if (convId) {
      this.patchConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.status === 'pending'
            ? { ...m, status: 'error' as const, errorCode: 'CANCELLED', errorMessage: 'You cancelled this question.' }
            : m,
        ),
      }));
    }
    this.sending.set(false);
  }

  /** Re-ask the question that produced a failed answer. */
  retry(messageId: string, options: AskOptions = {}): boolean {
    const conv = this.active();
    if (!conv || this.sending()) return false;
    const index = conv.messages.findIndex((m) => m.id === messageId);
    const question = conv.messages[index - 1];
    if (index < 1 || question?.role !== 'user') return false;
    this.patchConversation(conv.id, (c) => ({
      ...c,
      messages: c.messages.filter((_, i) => i !== index && i !== index - 1),
    }));
    return this.ask(question.content, options);
  }

  private patchConversation(id: string, fn: (c: Conversation) => Conversation): void {
    this.conversations.update((list) =>
      list.map((c) => (c.id === id ? { ...fn(c), updatedAt: new Date().toISOString() } : c)),
    );
    this.persist();
  }

  private patchMessage(convId: string, messageId: string, patch: Partial<ChatMessage>): void {
    this.patchConversation(convId, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
    }));
  }

  private persist(): void {
    try {
      // Pending messages are never saved: after a reload there is nothing left to wait for.
      const clean = this.conversations().map((c) => ({ ...c, messages: c.messages.filter((m) => m.status !== 'pending') }));
      localStorage.setItem(KEY, JSON.stringify(clean));
    } catch {
      /* storage full or blocked: keep working in memory */
    }
  }

  private restore(): Conversation[] {
    try {
      const raw = localStorage.getItem(KEY);
      const data: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(data)) return [];
      return (data as Conversation[]).filter(
        (c) => c && typeof c.id === 'string' && Array.isArray(c.messages) && typeof c.title === 'string',
      );
    } catch {
      return [];
    }
  }
}
