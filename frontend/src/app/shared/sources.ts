import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { SourceDto } from '../core/models';
import { IconComponent } from './icon';

/** Citations beneath an answer. Each source expands to show the exact passage the answer was built from. */
@Component({
  selector: 'app-sources',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sources().length > 0) {
      <section class="sources" [attr.aria-label]="heading()">
        <h4>{{ heading() }}</h4>
        <ul>
          @for (s of sources(); track s.ref) {
            <li [class.open]="expanded() === s.ref" [id]="idPrefix() + '-src-' + s.ref">
              <button type="button" class="row" [attr.aria-expanded]="expanded() === s.ref" (click)="toggle(s.ref)">
                <span class="ref" [class.cited]="s.cited" [title]="s.cited ? 'Cited in the answer' : 'Retrieved but not cited'">{{ s.ref }}</span>
                <span class="doc">{{ s.documentName }}</span>
                <span class="where">{{ location(s) }}</span>
                <span class="score" title="Similarity between the question and this passage">{{ percent(s.score) }} match</span>
                <app-icon name="chevron" class="chev" />
              </button>
              @if (expanded() === s.ref) {
                <blockquote class="passage">{{ s.text }}</blockquote>
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [`
    .sources{margin-top:14px;border-top:1px solid var(--rule);padding-top:10px}
    h4{margin:0 0 6px;font-size:.85rem;font-weight:600;color:var(--text-2)}
    ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
    li{border-radius:6px}
    li.open{background:var(--sheet-2)}
    .row{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;padding:7px 8px;cursor:pointer;border-radius:6px;font-size:.88rem;color:var(--text)}
    .row:hover{background:var(--sheet-2)}
    .row:focus-visible{box-shadow:var(--focus)}
    .ref{flex:none;min-width:24px;height:24px;border-radius:4px;display:grid;place-items:center;font-size:.78rem;font-weight:700;border:1px solid var(--rule-strong);color:var(--text-2)}
    .ref.cited{background:var(--mark);color:var(--mark-ink);border-color:transparent}
    .doc{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:0 1 auto}
    .where{color:var(--text-2);white-space:nowrap}
    .score{margin-left:auto;color:var(--text-3);font-size:.8rem;white-space:nowrap}
    .chev{color:var(--text-3);transition:transform .15s}
    li.open .chev{transform:rotate(90deg)}
    .passage{margin:2px 8px 10px 42px;padding:8px 0 8px 14px;border-left:3px solid var(--mark);font-family:var(--font-doc);font-size:.95rem;line-height:1.6;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere}
    @media (max-width:560px){.score{display:none}.where{margin-left:auto}}
  `],
})
export class SourcesComponent {
  readonly sources = input.required<SourceDto[]>();
  readonly grounded = input(true);
  readonly idPrefix = input('m');
  readonly expanded = model<number | null>(null);

  readonly heading = computed(() =>
    this.grounded()
      ? `Sources (${this.sources().length})`
      : `Closest passages (${this.sources().length}), not enough to answer`,
  );

  toggle(ref: number): void {
    this.expanded.update((current) => (current === ref ? null : ref));
  }

  location(s: SourceDto): string {
    return s.page ? `page ${s.page}` : `section ${s.chunkIndex + 1}`;
  }

  percent(score: number): string {
    return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
  }
}
