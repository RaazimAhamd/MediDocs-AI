import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { ChatStore } from '../../core/chat.store';
import { MAX_QUESTION_LENGTH } from '../../core/limits';
import { DocumentsStore } from '../../core/documents.store';
import { formatDuration, relativeTime, shortModelName } from '../../core/format';
import { HealthStore } from '../../core/health.store';
import { markdownCache } from './markdown-cache';
import { ChatMessage } from '../../core/models';
import { SettingsStore } from '../../core/settings.store';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog';
import { IconComponent } from '../../shared/icon';
import { SourcesComponent } from '../../shared/sources';

export const SUGGESTED_QUESTIONS = [
  'How many hours in advance must I cancel an outpatient appointment?',
  'What is the late cancellation fee for an MRI?',
  'What are the ICU visiting hours?',
  'How long does a medical records request take?',
  'Can I set up a payment plan for my bill?',
  'How do I appeal a late cancellation fee?',
];

const HINTS: Record<string, string> = {
  OLLAMA_UNAVAILABLE: 'Open the Ollama app (or run "ollama serve"), wait a few seconds, then retry.',
  OLLAMA_TIMEOUT: 'Local models can be slow on a laptop, especially the first time a model loads. Retry, or pick a smaller model in the model menu.',
  CLIENT_TIMEOUT: 'Try a smaller model or a shorter question.',
  BACKEND_UNREACHABLE: 'Start the backend with start.bat, then retry.',
  RATE_LIMITED: 'Wait a few seconds before asking again.',
};

@Component({
  selector: 'app-chat',
  imports: [IconComponent, SourcesComponent, ConfirmDialogComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chat">
      <aside class="convs" [class.open]="convOpen()" aria-label="Conversations">
        <button type="button" class="btn primary new" (click)="newConversation()"><app-icon name="plus" /> New conversation</button>
        <ul>
          @for (c of chat.conversations(); track c.id) {
            <li [class.active]="c.id === chat.activeId()">
              <button type="button" class="pick" [attr.aria-current]="c.id === chat.activeId() ? 'true' : null" (click)="pick(c.id)">
                <span class="t">{{ c.title }}</span>
                <span class="d">{{ relative(c.updatedAt) }}</span>
              </button>
              <button type="button" class="icon-btn" [attr.aria-label]="'Delete conversation ' + c.title" (click)="chat.deleteConversation(c.id)"><app-icon name="trash" /></button>
            </li>
          } @empty {
            <li class="none">Conversations you start will appear here.</li>
          }
        </ul>
      </aside>

      <section class="main">
        <header class="bar">
          <button type="button" class="btn small toggle" (click)="convOpen.set(!convOpen())" [attr.aria-expanded]="convOpen()"><app-icon name="list" /> Conversations</button>
          <h1>{{ chat.active()?.title ?? 'Ask your documents' }}</h1>
          <div class="controls">
            <div class="field">
              <label for="scope">Search in</label>
              <select id="scope" [value]="scope()" (change)="scope.set($any($event.target).value)">
                <option value="all">All ready documents</option>
                @for (d of docs.readyDocuments(); track d.id) { <option [value]="d.id">{{ d.name }}</option> }
              </select>
            </div>
            <div class="field">
              <label for="model">Model</label>
              <select id="model" [value]="settings.selectedModel() ?? ''" [disabled]="settings.models().length === 0" (change)="settings.select($any($event.target).value)">
                @for (m of settings.models(); track m.name) { <option [value]="m.name" [selected]="m.name === settings.selectedModel()">{{ m.name }}</option> }
                @if (settings.models().length === 0) { <option value="">No models found</option> }
              </select>
            </div>
            <button type="button" class="btn small" (click)="confirmClear.set(true)" [disabled]="chat.messages().length === 0">
              <app-icon name="eraser" /> Clear
            </button>
          </div>
        </header>

        @if (health.state() === 'backend-offline') {
          <div class="banner error" role="alert"><app-icon name="alert" /><div class="stack"><strong>The backend is not running.</strong><span>{{ health.backendError() }}</span></div></div>
        } @else if (health.state() === 'ollama-offline') {
          <div class="banner warn" role="status"><app-icon name="alert" /><div class="stack"><strong>Ollama is not running.</strong><span>Open the Ollama app or run <code>ollama serve</code>. Questions will fail until it is running.</span></div></div>
        } @else if (health.state() === 'models-missing') {
          <div class="banner warn" role="status"><app-icon name="alert" /><div class="stack"><strong>A required model is not installed.</strong>
            @for (m of health.health()?.ollama?.missingModels ?? []; track m) { <code>ollama pull {{ m }}</code> }</div></div>
        }

        <div class="thread" #thread role="log" aria-live="polite" aria-label="Conversation">
          @if (chat.messages().length === 0) {
            <div class="welcome">
              <h2>Ask a question about your documents</h2>
              @if (docs.loaded() && docs.readyDocuments().length === 0) {
                <p>You need at least one processed document first. <a routerLink="/documents">Upload a document</a>.</p>
              } @else {
                <p>Answers come only from your uploaded documents, with the exact passages shown underneath so you can check them.</p>
              }
              <div class="chips" role="group" aria-label="Suggested questions">
                @for (q of suggestions; track q) {
                  <button type="button" class="chip" [disabled]="chat.sending()" (click)="send(q)">{{ q }}</button>
                }
              </div>
            </div>
          }

          @for (m of chat.messages(); track m.id) {
            @if (m.role === 'user') {
              <div class="msg user"><div class="bubble">{{ m.content }}</div></div>
            } @else if (m.status === 'pending') {
              <div class="msg bot">
                <div class="bubble wait" role="status">
                  <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
                  <span>Searching your documents and writing an answer. Local models can take a minute.</span>
                  <button type="button" class="btn small" (click)="chat.cancel()"><app-icon name="stop" /> Cancel</button>
                </div>
              </div>
            } @else if (m.status === 'error') {
              <div class="msg bot">
                <div class="bubble fail" role="alert">
                  <strong>{{ m.errorCode === 'CANCELLED' ? 'Cancelled' : 'No answer' }}</strong>
                  <p>{{ m.errorMessage }}</p>
                  @if (hint(m)) { <p class="hint">{{ hint(m) }}</p> }
                  <button type="button" class="btn small" [disabled]="chat.sending()" (click)="retry(m)"><app-icon name="refresh" /> Ask again</button>
                </div>
              </div>
            } @else {
              <div class="msg bot">
                <div class="bubble answer" [class.weak]="m.response && !m.response.grounded">
                  <div class="md" [innerHTML]="html(m)" (click)="onCite($event, m.id)" (keydown.enter)="onCite($event, m.id)"></div>
                  @if (m.response; as r) {
                    @if (r.reason === 'NO_CITATIONS') {
                      <p class="note warn">The model did not cite any source. Check the passages below before relying on this answer.</p>
                    }
                    @if (r.reason === 'LOW_SIMILARITY') {
                      <p class="note">No passage was similar enough to the question, so the model was not asked to answer.</p>
                    }
                    @if (r.reason === 'NO_DOCUMENTS') {
                      <p class="note"><a routerLink="/documents">Go to Documents</a> to upload a file.</p>
                    }
                    <app-sources [sources]="r.sources" [grounded]="r.grounded" [idPrefix]="m.id" [expanded]="expandedFor(m.id)" (expandedChange)="setExpanded(m.id, $event)" />
                    <p class="meta">
                      @if (r.model) { <span>{{ shortModel(r.model) }}</span> }
                      @if (r.timings.generationMs > 0) { <span>answered in {{ duration(r.timings.retrievalMs + r.timings.generationMs) }}</span> }
                    </p>
                    <p class="disc">{{ r.disclaimer }}</p>
                  }
                </div>
              </div>
            }
          }
        </div>

        <div class="composer">
          <textarea
            #box
            rows="2"
            [value]="draft()"
            [maxLength]="maxLength"
            placeholder="Ask about a policy, fee, schedule or procedure in your documents"
            aria-label="Your question"
            (input)="draft.set(box.value)"
            (keydown.enter)="onEnter($event)"
          ></textarea>
          <div class="row">
            <span class="count" [class.near]="draft().length > maxLength * 0.8">{{ draft().length }} / {{ maxLength }}</span>
            <span class="hint-k">Enter to send, Shift+Enter for a new line</span>
            <button type="button" class="btn primary" [disabled]="!canSend()" (click)="send()"><app-icon name="send" /> Ask</button>
          </div>
          <p class="legal">AI answers can be wrong. Verify against the sources. Administrative information only, not medical advice.</p>
        </div>
      </section>
    </div>

    @if (confirmClear()) {
      <app-confirm-dialog title="Clear this conversation?" message="All messages in this conversation will be removed from this browser. Your documents are not affected." confirmLabel="Clear conversation" (cancelled)="confirmClear.set(false)" (confirmed)="clear()" />
    }
  `,
  styles: [`
    :host{display:block}
    .chat{display:grid;grid-template-columns:260px minmax(0,1fr);height:100vh;height:100dvh}
    .convs{border-right:1px solid var(--rule);background:var(--sheet);display:flex;flex-direction:column;gap:12px;padding:16px 12px;overflow-y:auto;min-height:0}
    .new{width:100%}
    .convs ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
    .convs li{display:flex;align-items:center;border-radius:6px}
    .convs li.active{background:var(--primary-soft)}
    .convs li:hover:not(.active){background:var(--sheet-2)}
    .pick{all:unset;box-sizing:border-box;flex:1;min-width:0;padding:8px 10px;cursor:pointer;display:flex;flex-direction:column;border-radius:6px}
    .pick:focus-visible{box-shadow:var(--focus)}
    .t{font-weight:600;font-size:.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .d{font-size:.76rem;color:var(--text-3)}
    .none{padding:8px 10px;color:var(--text-3);font-size:.86rem}
    .main{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%}
    .bar{display:flex;align-items:flex-end;gap:16px;padding:16px 24px 12px;border-bottom:1px solid var(--rule);flex-wrap:wrap}
    .bar h1{font-size:1.25rem;flex:1;min-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;align-self:center}
    .controls{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
    .controls .field{width:200px}
    .toggle{display:none}
    .banner{margin:12px 24px 0}
    .thread{flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:16px;min-height:0}
    .welcome{margin:auto;max-width:720px;text-align:center;padding:12px 0}
    .welcome h2{font-size:1.6rem;margin-bottom:8px}
    .welcome p{color:var(--text-2);margin-bottom:20px}
    .chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
    .chip{border:1px solid var(--rule-strong);background:var(--sheet);border-radius:999px;padding:8px 14px;cursor:pointer;font-size:.88rem;text-align:left}
    .chip:hover:not(:disabled){border-color:var(--primary);background:var(--primary-soft)}
    .chip:disabled{opacity:.5;cursor:not-allowed}
    .msg{display:flex}
    .msg.user{justify-content:flex-end}
    .bubble{max-width:min(780px,92%);padding:12px 16px;border-radius:12px;overflow-wrap:anywhere}
    .user .bubble{background:var(--primary);color:var(--on-primary);border-bottom-right-radius:3px;white-space:pre-wrap}
    .bot .bubble{background:var(--sheet);border:1px solid var(--rule);border-bottom-left-radius:3px}
    .bubble.weak{border-left:4px solid var(--warn)}
    .wait{display:flex;align-items:center;gap:12px;flex-wrap:wrap;color:var(--text-2)}
    .dots{display:inline-flex;gap:4px}
    .dots i{width:7px;height:7px;border-radius:50%;background:var(--primary);animation:bounce 1.1s infinite ease-in-out}
    .dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
    @keyframes bounce{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
    .fail{border-color:var(--err)!important;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
    .fail strong{color:var(--err)}
    .hint{color:var(--text-2);font-size:.9rem}
    .note{margin-top:10px;font-size:.88rem;color:var(--text-2)}
    .note.warn{color:var(--warn);background:var(--warn-soft);padding:8px 10px;border-radius:6px}
    .meta{display:flex;gap:14px;margin-top:10px;font-size:.78rem;color:var(--text-3)}
    .disc{margin-top:4px;font-size:.76rem;color:var(--text-3)}
    .composer{border-top:1px solid var(--rule);background:var(--sheet);padding:12px 24px 10px}
    textarea{resize:none;font-family:var(--font-ui);line-height:1.45;max-height:160px}
    .row{display:flex;align-items:center;gap:12px;margin-top:8px}
    .count{font-size:.78rem;color:var(--text-3)} .count.near{color:var(--warn);font-weight:600}
    .hint-k{flex:1;font-size:.78rem;color:var(--text-3)}
    .legal{margin-top:6px;font-size:.74rem;color:var(--text-3)}
    @media (max-width:900px){
      .chat{grid-template-columns:minmax(0,1fr);height:calc(100vh - 52px);height:calc(100dvh - 52px);position:relative}
      .convs{display:none;position:absolute;inset:0 auto 0 0;width:min(300px,86vw);z-index:20;box-shadow:8px 0 24px rgba(0,0,0,.2)}
      .convs.open{display:flex}
      .toggle{display:inline-flex}
      .bar{padding:12px 14px}
      .controls .field{width:calc(50% - 5px)}
      .thread{padding:14px}
      .composer{padding:10px 14px 8px}
      .banner{margin:10px 14px 0}
      .hint-k{display:none}
      .row{justify-content:space-between}
    }
  `],
})
export class ChatComponent {
  protected readonly chat = inject(ChatStore);
  protected readonly docs = inject(DocumentsStore);
  protected readonly settings = inject(SettingsStore);
  protected readonly health = inject(HealthStore);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');

  protected readonly suggestions = SUGGESTED_QUESTIONS;
  protected get maxLength(): number {
    return MAX_QUESTION_LENGTH;
  }
  protected readonly draft = signal('');
  protected readonly scope = signal('all');
  protected readonly convOpen = signal(false);
  protected readonly confirmClear = signal(false);
  private readonly expanded = signal<Record<string, number | null>>({});

  protected relative = relativeTime;
  protected duration = formatDuration;
  protected shortModel = shortModelName;

  constructor() {
    effect(() => {
      const messages = this.chat.messages();
      void messages.length;
      setTimeout(() => {
        const el = this.thread()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
    effect(() => {
      // Fall back to "all" if the selected document was deleted.
      const id = this.scope();
      if (id !== 'all' && !this.docs.documents().some((d) => d.id === id)) this.scope.set('all');
    });
  }

  protected canSend(): boolean {
    const text = this.draft().trim();
    return text.length >= 3 && text.length <= this.maxLength && !this.chat.sending();
  }

  private options() {
    return {
      model: this.settings.selectedModel(),
      documentIds: this.scope() === 'all' ? undefined : [this.scope()],
    };
  }

  protected send(text: string = this.draft()): void {
    if (this.chat.ask(text, this.options())) {
      this.draft.set('');
      this.convOpen.set(false);
    }
  }

  protected onEnter(event: Event): void {
    const e = event as KeyboardEvent;
    if (e.shiftKey || e.isComposing) return;
    e.preventDefault();
    if (this.canSend()) this.send();
  }

  protected retry(m: ChatMessage): void {
    this.chat.retry(m.id, this.options());
  }

  protected newConversation(): void {
    this.chat.newConversation();
    this.convOpen.set(false);
  }

  protected pick(id: string): void {
    this.chat.select(id);
    this.convOpen.set(false);
  }

  protected clear(): void {
    this.confirmClear.set(false);
    this.chat.clearActive();
  }

  protected hint(m: ChatMessage): string | null {
    return (m.errorCode && HINTS[m.errorCode]) || null;
  }

  protected html(m: ChatMessage): SafeHtml {
    // The string is already escaped and sanitised by renderMarkdown (DOMPurify); Angular's own
    // sanitiser would strip the data-cite attribute that links [1] chips to their sources.
    return this.sanitizer.bypassSecurityTrustHtml(markdownCache(m.id, m.content));
  }

  protected expandedFor(id: string): number | null {
    return this.expanded()[id] ?? null;
  }

  protected setExpanded(id: string, ref: number | null): void {
    this.expanded.update((map) => ({ ...map, [id]: ref }));
  }

  protected onCite(event: Event, messageId: string): void {
    const target = event.target as HTMLElement | null;
    const chip = target?.closest?.('.cite') as HTMLElement | null;
    const ref = Number(chip?.dataset['cite']);
    if (!chip || !ref) return;
    this.setExpanded(messageId, ref);
    setTimeout(() => document.getElementById(`${messageId}-src-${ref}`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
  }
}
