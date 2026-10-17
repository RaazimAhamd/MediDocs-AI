import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DocumentDto } from '../core/models';

@Component({
  selector: 'app-status-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="pill" [class]="'pill ' + doc().status">{{ label() }}</span>`,
})
export class StatusPillComponent {
  readonly doc = input.required<DocumentDto>();
  readonly label = computed(() => {
    const d = this.doc();
    switch (d.status) {
      case 'ready':
        return 'Ready';
      case 'failed':
        return 'Failed';
      case 'queued':
        return 'Queued';
      default:
        return d.stage === 'embedding' && d.progress
          ? `Indexing ${d.progress.done}/${d.progress.total}`
          : 'Reading file';
    }
  });
}
