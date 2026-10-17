import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ChatStore } from '../../core/chat.store';
import { DocumentsStore } from '../../core/documents.store';
import { formatBytes, relativeTime, shortModelName } from '../../core/format';
import { HealthStore } from '../../core/health.store';
import { SettingsStore } from '../../core/settings.store';
import { IconComponent } from '../../shared/icon';
import { StatusPillComponent } from '../../shared/status-pill';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, IconComponent, StatusPillComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <h1>Dashboard</h1>
        <p>Your private document library and the local AI behind it. Everything runs on this computer.</p>
      </header>

      @if (health.state() === 'backend-offline') {
        <div class="banner error" role="alert">
          <app-icon name="alert" />
          <div class="stack"><strong>The MediDocs backend is not running.</strong><span>{{ health.backendError() }}</span></div>
        </div>
      }

      <section class="band" aria-label="Summary">
        @if (!docs.loaded()) {
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="stat"><span class="skeleton" style="width:60%"></span><span class="skeleton" style="width:40%;height:28px;margin-top:10px"></span></div>
          }
        } @else {
          <div class="stat">
            <span class="k">Documents</span>
            <span class="v">{{ docs.totals().documents }}</span>
            <span class="s">{{ docs.totals().ready }} ready@if (docs.activeCount() > 0) {, {{ docs.activeCount() }} processing}@if (docs.totals().failed > 0) {, {{ docs.totals().failed }} failed}</span>
          </div>
          <div class="stat">
            <span class="k">Passages indexed</span>
            <span class="v">{{ docs.totals().chunks }}</span>
            <span class="s">searchable text sections</span>
          </div>
          <div class="stat">
            <span class="k">Library size</span>
            <span class="v">{{ bytes() }}</span>
            <span class="s">stored on this computer</span>
          </div>
          <div class="stat">
            <span class="k">Answer model</span>
            <span class="v model">{{ model() }}</span>
            <span class="s">{{ health.label() }}</span>
          </div>
        }
      </section>

      <div class="grid">
        <section class="panel">
          <div class="panel-head">
            <h2>Recent documents</h2>
            <a class="btn small" routerLink="/documents">Manage documents</a>
          </div>
          @if (!docs.loaded()) {
            <div class="panel-body list">
              @for (i of [1, 2, 3]; track i) { <span class="skeleton" style="height:18px"></span> }
            </div>
          } @else if (recentDocs().length === 0) {
            <div class="empty">
              <h3>No documents yet</h3>
              <p>Upload a PDF or text file, such as the fictional hospital policies in the sample-documents folder.</p>
              <a class="btn primary" routerLink="/documents"><app-icon name="upload" /> Upload a document</a>
            </div>
          } @else {
            <ul class="rows">
              @for (d of recentDocs(); track d.id) {
                <li>
                  <app-icon name="file" class="ico" />
                  <div class="main">
                    <span class="title" [title]="d.name">{{ d.name }}</span>
                    <span class="sub">{{ relative(d.uploadedAt) }}, {{ size(d.sizeBytes) }}@if (d.chunkCount) {, {{ d.chunkCount }} passages}</span>
                  </div>
                  <app-status-pill [doc]="d" />
                </li>
              }
            </ul>
          }
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Recent questions</h2>
            <a class="btn small" routerLink="/chat">Ask a question</a>
          </div>
          @if (chat.recentQuestions().length === 0) {
            <div class="empty">
              <h3>No questions yet</h3>
              <p>Ask about appointment rules, visiting hours or billing once a document is ready.</p>
              <a class="btn primary" routerLink="/chat"><app-icon name="chat" /> Start asking</a>
            </div>
          } @else {
            <ul class="rows">
              @for (q of chat.recentQuestions(); track q.createdAt + q.text) {
                <li>
                  <app-icon name="chat" class="ico" />
                  <button type="button" class="q" (click)="open(q.conversationId)">
                    <span class="title">{{ q.text }}</span>
                    <span class="sub">{{ relative(q.createdAt) }}</span>
                  </button>
                </li>
              }
            </ul>
          }
        </section>
      </div>

      <section class="panel sys">
        <div class="panel-head">
          <h2>System status</h2>
          <button type="button" class="btn small" (click)="health.refresh()" [disabled]="health.checking()">
            <app-icon name="refresh" /> Check again
          </button>
        </div>
        <dl>
          <div><dt>Backend API</dt><dd [class.bad]="health.state() === 'backend-offline'">{{ health.state() === 'backend-offline' ? 'Not reachable' : health.health() ? 'Running' : 'Checking' }}</dd></div>
          <div><dt>Ollama</dt><dd [class.bad]="health.health() && !health.health()!.ollama.reachable">
            @if (!health.health()) { Checking } @else if (health.health()!.ollama.reachable) { Running, version {{ health.health()!.ollama.version }} } @else { Not reachable }
          </dd></div>
          <div><dt>Embedding model</dt><dd [class.bad]="health.health()?.ollama?.embedModel?.installed === false">
            {{ health.health()?.ollama?.embedModel?.name ?? 'Unknown' }}@if (health.health()?.ollama?.embedModel?.installed === false) { (not installed) }
          </dd></div>
          <div><dt>Default chat model</dt><dd [class.bad]="health.health()?.ollama?.chatModel?.installed === false">
            {{ health.health()?.ollama?.chatModel?.name ?? 'Unknown' }}@if (health.health()?.ollama?.chatModel?.installed === false) { (not installed) }
          </dd></div>
        </dl>
        @if (health.health() && health.health()!.ollama.reachable === false) {
          <div class="banner warn fix"><app-icon name="alert" /><div class="stack">
            <strong>Ollama is not running.</strong>
            <span>Open the Ollama app, or run <code>ollama serve</code> in a terminal, then choose Check again.</span>
          </div></div>
        }
        @if (health.health()?.ollama?.missingModels?.length) {
          <div class="banner warn fix"><app-icon name="alert" /><div class="stack">
            <strong>Missing models. Install them in a terminal:</strong>
            @for (m of health.health()!.ollama.missingModels!; track m) { <code>ollama pull {{ m }}</code> }
          </div></div>
        }
      </section>
    </div>
  `,
  styles: [`
    .band{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--sheet);border:1px solid var(--rule);border-radius:8px;margin-bottom:20px}
    .stat{display:flex;flex-direction:column;padding:18px 20px;border-left:1px solid var(--rule);min-width:0}
    .stat:first-child{border-left:0}
    .k{font-size:.84rem;color:var(--text-2);font-weight:600}
    .v{font-family:var(--font-doc);font-size:2rem;line-height:1.15;margin-top:4px}
    .v.model{font-size:1.35rem;margin-top:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .s{font-size:.82rem;color:var(--text-3);margin-top:2px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-bottom:20px;align-items:start}
    .list{display:flex;flex-direction:column;gap:14px}
    .rows{list-style:none;margin:0;padding:6px 8px}
    .rows li{display:flex;align-items:center;gap:12px;padding:10px;border-radius:6px}
    .rows li + li{border-top:1px solid var(--rule)}
    .ico{color:var(--text-3);flex:none}
    .main,.q{display:flex;flex-direction:column;min-width:0;flex:1;text-align:left}
    .q{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;min-width:0;flex:1;border-radius:4px}
    .q:hover .title{text-decoration:underline}
    .q:focus-visible{box-shadow:var(--focus)}
    .title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sub{font-size:.82rem;color:var(--text-3)}
    .sys dl{margin:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}
    .sys dl div{padding:14px 18px;border-left:1px solid var(--rule)}
    .sys dl div:first-child{border-left:0}
    dt{font-size:.82rem;color:var(--text-2);font-weight:600}
    dd{margin:2px 0 0;overflow-wrap:anywhere}
    dd.bad{color:var(--err);font-weight:600}
    .fix{margin:0 18px 18px}
    .fix code{align-self:flex-start}
    @media (max-width:900px){
      .band,.sys dl{grid-template-columns:repeat(2,minmax(0,1fr))}
      .stat:nth-child(3),.sys dl div:nth-child(3){border-left:0}
      .stat:nth-child(n+3),.sys dl div:nth-child(n+3){border-top:1px solid var(--rule)}
      .grid{grid-template-columns:minmax(0,1fr)}
    }
  `],
})
export class DashboardComponent {
  protected readonly docs = inject(DocumentsStore);
  protected readonly chat = inject(ChatStore);
  protected readonly health = inject(HealthStore);
  private readonly settings = inject(SettingsStore);
  private readonly router = inject(Router);

  protected readonly recentDocs = computed(() => this.docs.documents().slice(0, 5));
  protected readonly bytes = computed(() => formatBytes(this.docs.totals().bytes));
  protected readonly model = computed(() => {
    const m = this.settings.selectedModel() ?? this.health.health()?.ollama.chatModel?.name;
    return m ? shortModelName(m) : 'Not set';
  });

  protected relative = relativeTime;
  protected size = formatBytes;

  protected open(conversationId: string): void {
    this.chat.select(conversationId);
    void this.router.navigateByUrl('/chat');
  }
}
