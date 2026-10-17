import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ChatStore } from '../../core/chat.store';
import { formatBytes } from '../../core/format';
import { HealthStore } from '../../core/health.store';
import { SettingsStore } from '../../core/settings.store';
import { ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog';
import { IconComponent } from '../../shared/icon';

@Component({
  selector: 'app-settings',
  imports: [IconComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <h1>Settings</h1>
        <p>Choose the answer model and appearance. Retrieval settings are set on the server.</p>
      </header>

      <section class="panel block">
        <div class="panel-head"><h2>Answer model</h2>
          <button type="button" class="btn small" (click)="refresh()" [disabled]="settings.modelsLoading()"><app-icon name="refresh" /> Refresh list</button>
        </div>
        <div class="panel-body">
          @if (settings.modelsError()) {
            <div class="banner error" role="alert"><app-icon name="alert" /><div class="stack"><strong>Could not list installed models.</strong><span>{{ settings.modelsError() }}</span></div></div>
          } @else if (settings.models().length === 0 && !settings.modelsLoading()) {
            <div class="banner warn"><app-icon name="alert" /><div class="stack"><strong>No supported chat model is installed.</strong><span>Install one in a terminal, then choose Refresh list:</span><code>ollama pull gemma3</code><code>ollama pull llama3</code></div></div>
          } @else {
            <div class="field narrow">
              <label for="model">Model used to write answers</label>
              <select id="model" [value]="settings.selectedModel() ?? ''" (change)="pick($any($event.target).value)">
                @for (m of settings.models(); track m.name) {
                  <option [value]="m.name" [selected]="m.name === settings.selectedModel()">{{ m.name }} ({{ size(m.sizeBytes) }})@if (m.name === settings.defaultModel()) { , default }</option>
                }
              </select>
            </div>
            <p class="help">Only models you have already installed in Ollama are listed. Smaller models such as gemma3 answer faster on 8 GB of RAM; larger ones such as llama3 may be slow. Embeddings always use <code>{{ settings.serverSettings()?.embedModel ?? 'nomic-embed-text' }}</code>.</p>
          }
        </div>
      </section>

      <section class="panel block">
        <div class="panel-head"><h2>Appearance</h2></div>
        <div class="panel-body seg" role="group" aria-label="Theme">
          <button type="button" class="btn" [attr.aria-pressed]="theme.theme() === 'light'" [class.primary]="theme.theme() === 'light'" (click)="theme.set('light')"><app-icon name="sun" /> Light</button>
          <button type="button" class="btn" [attr.aria-pressed]="theme.theme() === 'dark'" [class.primary]="theme.theme() === 'dark'" (click)="theme.set('dark')"><app-icon name="moon" /> Dark</button>
        </div>
      </section>

      <section class="panel block">
        <div class="panel-head"><h2>Retrieval settings</h2></div>
        <div class="panel-body">
          @if (settings.serverSettings(); as s) {
            <dl>
              <div><dt>Passage size</dt><dd>{{ s.chunkSize }} characters</dd></div>
              <div><dt>Overlap</dt><dd>{{ s.chunkOverlap }} characters</dd></div>
              <div><dt>Passages per question</dt><dd>{{ s.topK }}</dd></div>
              <div><dt>Minimum similarity</dt><dd>{{ s.minSimilarity }}</dd></div>
              <div><dt>Upload limit</dt><dd>{{ s.maxUploadMb }} MB</dd></div>
              <div><dt>File types</dt><dd>{{ s.allowedExtensions.join(', ') }}</dd></div>
            </dl>
            <p class="help">These values are read-only here. Change them in <code>backend/.env</code> and restart the backend. Changing passage size or overlap only affects documents uploaded afterwards.</p>
          } @else {
            <span class="skeleton" style="height:18px"></span>
          }
        </div>
      </section>

      <section class="panel block">
        <div class="panel-head"><h2>Local data</h2></div>
        <div class="panel-body">
          <p class="help flush">Conversations are stored only in this browser. Documents and their embeddings are stored in the backend data folder on this computer.</p>
          <button type="button" class="btn" (click)="confirmReset.set(true)" [disabled]="chat.conversations().length === 0"><app-icon name="trash" /> Clear chat history</button>
        </div>
      </section>

      <section class="panel block">
        <div class="panel-head"><h2>About this demo</h2></div>
        <div class="panel-body about">
          <p>MediDocs AI is a local portfolio project that answers questions about administrative healthcare documents using retrieval-augmented generation with Ollama.</p>
          <ul>
            <li>It is not a medical device and gives no medical advice, diagnosis or treatment guidance.</li>
            <li>There is no sign-in. It listens on this computer only. Do not upload real patient data.</li>
            <li>Answers are generated by a small local language model and can be wrong. Always check the cited passages.</li>
          </ul>
          <p class="help flush">Assistant status: {{ health.label() }}</p>
        </div>
      </section>
    </div>

    @if (confirmReset()) {
      <app-confirm-dialog title="Clear all chat history?" message="Every conversation will be removed from this browser. Your documents are not affected." confirmLabel="Clear history" (cancelled)="confirmReset.set(false)" (confirmed)="reset()" />
    }
  `,
  styles: [`
    .block{margin-bottom:18px;max-width:820px}
    .narrow{max-width:420px}
    .help{margin-top:12px;color:var(--text-2);font-size:.9rem;max-width:68ch}
    .help.flush{margin:0 0 12px}
    .seg{display:flex;gap:8px}
    dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 20px;margin:0}
    dt{font-size:.82rem;color:var(--text-2);font-weight:600}
    dd{margin:2px 0 0}
    .about ul{margin:10px 0;padding-left:20px;color:var(--text-2)}
    .about li{margin:4px 0}
    code{display:inline-block}
    @media (max-width:700px){dl{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `],
})
export class SettingsComponent {
  protected readonly settings = inject(SettingsStore);
  protected readonly theme = inject(ThemeService);
  protected readonly chat = inject(ChatStore);
  protected readonly health = inject(HealthStore);
  private readonly toast = inject(ToastService);

  protected readonly confirmReset = signal(false);
  protected size = formatBytes;

  protected pick(name: string): void {
    this.settings.select(name);
    this.toast.success(`Answers will now use ${name}.`);
  }

  protected refresh(): void {
    this.settings.loadModels();
    this.health.refresh();
  }

  protected reset(): void {
    this.confirmReset.set(false);
    this.chat.clearAll();
    this.toast.success('Chat history cleared.');
  }
}
