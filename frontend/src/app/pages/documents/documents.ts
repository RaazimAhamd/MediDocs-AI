import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/api-error';
import { DocumentsStore } from '../../core/documents.store';
import { formatBytes, formatDate } from '../../core/format';
import { HealthStore } from '../../core/health.store';
import { ChunkDto, DocumentDto } from '../../core/models';
import { SettingsStore } from '../../core/settings.store';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog';
import { IconComponent } from '../../shared/icon';
import { StatusPillComponent } from '../../shared/status-pill';

const PAGE_SIZE = 10;

@Component({
  selector: 'app-documents',
  imports: [IconComponent, StatusPillComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <h1>Documents</h1>
        <p>Upload PDF or text files. MediDocs reads them, splits them into passages and indexes them on this computer.</p>
      </header>

      @if (health.state() === 'ollama-offline' || health.state() === 'models-missing') {
        <div class="banner warn top" role="status">
          <app-icon name="alert" />
          <div class="stack">
            <strong>{{ health.state() === 'ollama-offline' ? 'Ollama is not running.' : 'A required model is missing.' }}</strong>
            <span>Uploads are accepted, but indexing cannot finish until it is fixed. See the Dashboard for the exact steps.</span>
          </div>
        </div>
      }

      <div
        class="drop"
        [class.over]="dragging()"
        (dragover)="onDragOver($event)"
        (dragleave)="dragging.set(false)"
        (drop)="onDrop($event)"
      >
        <app-icon name="upload" />
        <div class="txt">
          <strong>Drop a file here</strong>
          <span>PDF or TXT, up to {{ maxMb() }} MB each. Use fictional or public documents only, never real patient records.</span>
        </div>
        <label class="btn primary" tabindex="0" (keydown.enter)="picker.click()" (keydown.space)="picker.click(); $event.preventDefault()">
          Choose files
          <input #picker type="file" class="visually-hidden" accept=".pdf,.txt,application/pdf,text/plain" multiple (change)="onPick($event, picker)" aria-label="Choose files to upload" />
        </label>
      </div>

      @if (store.uploads().length > 0) {
        <ul class="uploads" aria-label="Uploads in progress">
          @for (u of store.uploads(); track u.key) {
            <li [class.err]="u.state === 'error'">
              <span class="n">{{ u.name }}</span>
              @if (u.state === 'uploading') {
                <span class="bar" role="progressbar" [attr.aria-valuenow]="u.progress" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="'Uploading ' + u.name"><span [style.width.%]="u.progress"></span></span>
                <span class="pct">{{ u.progress }}%</span>
              } @else {
                <span class="e">{{ u.error }}</span>
                <button type="button" class="icon-btn" aria-label="Dismiss" (click)="store.dismissUpload(u.key)"><app-icon name="close" /></button>
              }
            </li>
          }
        </ul>
      }

      <section class="panel list">
        <div class="panel-head">
          <h2>Library @if (store.documents().length) { <span class="count">{{ store.documents().length }}</span> }</h2>
          <button type="button" class="btn small" (click)="store.load()"><app-icon name="refresh" /> Refresh</button>
        </div>

        @if (!store.loaded()) {
          <div class="panel-body skel">
            @for (i of [1, 2, 3]; track i) { <span class="skeleton" style="height:20px"></span> }
          </div>
        } @else if (store.error()) {
          <div class="panel-body"><div class="banner error" role="alert"><app-icon name="alert" /><div class="stack"><strong>Could not load documents.</strong><span>{{ store.error() }}</span></div></div></div>
        } @else if (store.documents().length === 0) {
          <div class="empty">
            <h3>Your library is empty</h3>
            <p>Add a document above to start asking questions. The sample-documents folder in this project has fictional hospital policies you can try.</p>
          </div>
        } @else {
          <div class="table" role="table" aria-label="Documents">
            <div class="tr th" role="row">
              <span role="columnheader">Name</span><span role="columnheader">Uploaded</span><span role="columnheader">Size</span>
              <span role="columnheader">Pages</span><span role="columnheader">Passages</span><span role="columnheader">Status</span><span role="columnheader" class="actions-h">Actions</span>
            </div>
            @for (d of store.documents(); track d.id) {
              <div class="tr" role="row">
                <span class="name" role="cell">
                  <app-icon name="file" />
                  <span class="nm">
                    <span class="t" [title]="d.name">{{ d.name }}</span>
                    @if (d.status === 'failed' && d.error) { <span class="fail">{{ d.error.message }}</span> }
                    @if (d.status === 'processing' && d.progress) {
                      <span class="bar slim" role="progressbar" [attr.aria-valuenow]="pct(d)" aria-valuemin="0" aria-valuemax="100"><span [style.width.%]="pct(d)"></span></span>
                    }
                  </span>
                </span>
                <span role="cell" data-label="Uploaded">{{ date(d.uploadedAt) }}</span>
                <span role="cell" data-label="Size">{{ size(d.sizeBytes) }}</span>
                <span role="cell" data-label="Pages">{{ d.pageCount ?? 'n/a' }}</span>
                <span role="cell" data-label="Passages">{{ d.status === 'ready' ? d.chunkCount : 'n/a' }}</span>
                <span role="cell"><app-status-pill [doc]="d" /></span>
                <span role="cell" class="actions">
                  @if (d.status === 'ready') {
                    <button type="button" class="btn small quiet" [attr.aria-expanded]="openId() === d.id" (click)="togglePassages(d)"><app-icon name="list" /> Passages</button>
                  }
                  @if (d.status === 'failed') {
                    <button type="button" class="btn small" (click)="store.retry(d)"><app-icon name="refresh" /> Retry</button>
                  }
                  <button type="button" class="btn small quiet danger-text" [attr.aria-label]="'Delete ' + d.name" (click)="pendingDelete.set(d)"><app-icon name="trash" /> Delete</button>
                </span>
              </div>
              @if (openId() === d.id) {
                <div class="passages" role="region" [attr.aria-label]="'Passages of ' + d.name">
                  @if (chunksError()) { <div class="banner error">{{ chunksError() }}</div> }
                  @for (c of chunks(); track c.index) {
                    <article>
                      <header>{{ c.page ? 'Page ' + c.page : 'Section ' + (c.index + 1) }}, passage {{ c.index + 1 }}</header>
                      <p>{{ c.text }}</p>
                    </article>
                  }
                  @if (chunksLoading()) { <span class="skeleton" style="height:48px"></span> }
                  @if (chunks().length < chunksTotal() && !chunksLoading()) {
                    <button type="button" class="btn small" (click)="loadMore(d)">Show more passages ({{ chunksTotal() - chunks().length }} left)</button>
                  }
                </div>
              }
            }
          </div>
        }
      </section>
    </div>

    @if (pendingDelete(); as d) {
      <app-confirm-dialog
        title="Delete this document?"
        [message]="'&quot;' + d.name + '&quot; and all of its passages and embeddings will be permanently removed from this computer.'"
        confirmLabel="Delete document"
        (cancelled)="pendingDelete.set(null)"
        (confirmed)="confirmDelete(d)"
      />
    }
  `,
  styles: [`
    .top{margin-bottom:16px}
    .drop{display:flex;align-items:center;gap:16px;padding:18px 20px;border:2px dashed var(--rule-strong);border-radius:8px;background:var(--sheet);margin-bottom:16px;transition:border-color .12s,background .12s}
    .drop.over{border-color:var(--primary);background:var(--primary-soft)}
    .drop > app-icon{color:var(--primary);flex:none}
    .txt{display:flex;flex-direction:column;flex:1;min-width:0}
    .txt span{color:var(--text-2);font-size:.88rem}
    label.btn{cursor:pointer}
    label.btn:focus-visible{box-shadow:var(--focus)}
    .uploads{list-style:none;margin:0 0 16px;padding:0;display:flex;flex-direction:column;gap:6px}
    .uploads li{display:flex;align-items:center;gap:12px;padding:8px 12px;border:1px solid var(--rule);background:var(--sheet);border-radius:6px}
    .uploads li.err{border-color:var(--err)}
    .n{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:40%}
    .e{color:var(--err);flex:1;font-size:.88rem}
    .bar{flex:1;height:8px;border-radius:999px;background:var(--rule);overflow:hidden;display:block}
    .bar > span{display:block;height:100%;background:var(--primary);transition:width .2s}
    .bar.slim{height:5px;margin-top:6px;max-width:220px}
    .pct{font-size:.84rem;color:var(--text-2);width:3ch;text-align:right}
    .count{font-family:var(--font-ui);font-size:.8rem;font-weight:600;background:var(--sheet-2);border:1px solid var(--rule);border-radius:999px;padding:1px 9px;margin-left:6px;vertical-align:middle}
    .skel{display:flex;flex-direction:column;gap:14px}
    .table{display:flex;flex-direction:column}
    .tr{display:grid;grid-template-columns:minmax(220px,2.6fr) 1.3fr .8fr .6fr .8fr 1.1fr minmax(190px,1.7fr);gap:12px;align-items:center;padding:12px 18px;border-bottom:1px solid var(--rule);font-size:.9rem}
    .tr:last-child{border-bottom:0}
    .th{font-size:.8rem;font-weight:600;color:var(--text-2);background:var(--sheet-2);padding-top:9px;padding-bottom:9px}
    .name{display:flex;align-items:flex-start;gap:10px;min-width:0}
    .name app-icon{color:var(--text-3);margin-top:2px;flex:none}
    .nm{display:flex;flex-direction:column;min-width:0}
    .t{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .fail{color:var(--err);font-size:.82rem;margin-top:2px}
    .actions{display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap}
    .actions-h{text-align:right}
    .danger-text{color:var(--err)}
    .passages{padding:6px 18px 16px 46px;background:var(--sheet-2);border-bottom:1px solid var(--rule);display:flex;flex-direction:column;gap:10px}
    .passages article{border-left:3px solid var(--mark);padding:2px 0 2px 12px}
    .passages header{font-size:.78rem;font-weight:600;color:var(--text-2);margin-bottom:2px}
    .passages p{font-family:var(--font-doc);line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.95rem}
    .passages .btn{align-self:flex-start}
    @media (max-width:1000px){
      .th{display:none}
      .tr{grid-template-columns:1fr 1fr;gap:6px 12px}
      .tr .name{grid-column:1 / -1}
      .tr [data-label]::before{content:attr(data-label) ': ';color:var(--text-3)}
      .actions{grid-column:1 / -1;justify-content:flex-start}
      .passages{padding-left:18px}
      .drop{flex-wrap:wrap}
    }
  `],
})
export class DocumentsComponent {
  protected readonly store = inject(DocumentsStore);
  protected readonly health = inject(HealthStore);
  private readonly settings = inject(SettingsStore);
  private readonly api = inject(ApiService);

  protected readonly dragging = signal(false);
  protected readonly pendingDelete = signal<DocumentDto | null>(null);
  protected readonly openId = signal<string | null>(null);
  protected readonly chunks = signal<ChunkDto[]>([]);
  protected readonly chunksTotal = signal(0);
  protected readonly chunksLoading = signal(false);
  protected readonly chunksError = signal<string | null>(null);

  protected readonly maxMb = computed(() => this.settings.serverSettings()?.maxUploadMb ?? 10);
  protected size = formatBytes;
  protected date = formatDate;

  protected pct(d: DocumentDto): number {
    return d.progress && d.progress.total > 0 ? Math.round((d.progress.done / d.progress.total) * 100) : 0;
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.uploadAll(event.dataTransfer?.files ?? null);
  }

  protected onPick(event: Event, input: HTMLInputElement): void {
    this.uploadAll((event.target as HTMLInputElement).files);
    input.value = ''; // allow choosing the same file again
  }

  private uploadAll(files: FileList | null): void {
    if (!files) return;
    for (const file of Array.from(files)) this.store.upload(file);
  }

  protected confirmDelete(doc: DocumentDto): void {
    this.pendingDelete.set(null);
    if (this.openId() === doc.id) this.openId.set(null);
    this.store.remove(doc);
  }

  protected togglePassages(doc: DocumentDto): void {
    if (this.openId() === doc.id) {
      this.openId.set(null);
      return;
    }
    this.openId.set(doc.id);
    this.chunks.set([]);
    this.chunksTotal.set(0);
    this.chunksError.set(null);
    this.loadMore(doc);
  }

  protected loadMore(doc: DocumentDto): void {
    this.chunksLoading.set(true);
    this.api.listChunks(doc.id, this.chunks().length, PAGE_SIZE).subscribe({
      next: (r) => {
        if (this.openId() !== doc.id) return;
        this.chunks.update((list) => [...list, ...r.chunks]);
        this.chunksTotal.set(r.total);
        this.chunksLoading.set(false);
      },
      error: (e: unknown) => {
        this.chunksError.set(errorMessage(e, 'Could not load passages.'));
        this.chunksLoading.set(false);
      },
    });
  }
}
