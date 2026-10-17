import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="cancelled.emit()" (keydown.escape)="cancelled.emit()" role="presentation">
      <div class="dialog" role="alertdialog" aria-modal="true" [attr.aria-label]="title()" (click)="$event.stopPropagation()" tabindex="-1">
        <h2>{{ title() }}</h2>
        <p>{{ message() }}</p>
        <div class="actions">
          <button type="button" class="btn" (click)="cancelled.emit()">Cancel</button>
          <button type="button" class="btn danger" #confirmBtn (click)="confirmed.emit()">{{ confirmLabel() }}</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .backdrop{position:fixed;inset:0;background:rgba(8,16,32,.55);display:grid;place-items:center;z-index:90;padding:16px}
    .dialog{background:var(--sheet);color:var(--text);border:1px solid var(--rule-strong);border-radius:8px;padding:22px;width:min(440px,100%);box-shadow:0 20px 60px rgba(0,0,0,.35)}
    h2{margin:0 0 8px;font-family:var(--font-doc);font-size:1.25rem}
    p{margin:0 0 20px;color:var(--text-2);line-height:1.5}
    .actions{display:flex;justify-content:flex-end;gap:8px}
  `],
  host: { '(document:keydown.escape)': 'cancelled.emit()' },
})
export class ConfirmDialogComponent {
  readonly title = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmLabel = input('Delete');
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
