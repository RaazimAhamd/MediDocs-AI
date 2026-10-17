import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';
import { IconComponent } from './icon';

@Component({
  selector: 'app-toast-container',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" aria-live="polite" aria-atomic="false">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast" [class]="'toast ' + t.kind" [attr.role]="t.kind === 'error' ? 'alert' : 'status'">
          <app-icon [name]="t.kind === 'error' ? 'alert' : 'check'" />
          <span class="msg">{{ t.message }}</span>
          <button type="button" class="icon-btn" aria-label="Dismiss notification" (click)="toasts.dismiss(t.id)">
            <app-icon name="close" />
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toasts{position:fixed;right:16px;bottom:16px;z-index:100;display:flex;flex-direction:column;gap:8px;width:min(380px,calc(100vw - 32px))}
    .toast{display:flex;align-items:flex-start;gap:10px;padding:10px 10px 10px 14px;border-radius:6px;border:1px solid var(--rule-strong);background:var(--sheet);color:var(--text);box-shadow:0 6px 24px rgba(10,20,40,.18);animation:in .18s ease-out}
    .toast.success{border-left:4px solid var(--ok)} .toast.error{border-left:4px solid var(--err)} .toast.info{border-left:4px solid var(--primary)}
    .toast app-icon{margin-top:2px;flex:none}
    .toast.success app-icon{color:var(--ok)} .toast.error app-icon{color:var(--err)} .toast.info app-icon{color:var(--primary)}
    .msg{flex:1;font-size:.9rem;line-height:1.4;overflow-wrap:anywhere}
    @keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  `],
})
export class ToastContainerComponent {
  readonly toasts = inject(ToastService);
}
