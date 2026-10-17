import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'dashboard' | 'documents' | 'chat' | 'settings' | 'upload' | 'trash' | 'refresh' | 'sun' | 'moon'
  | 'send' | 'stop' | 'plus' | 'chevron' | 'alert' | 'check' | 'menu' | 'close' | 'eraser' | 'file' | 'list';

/** Small inline SVG icon set (no icon font or network request needed). */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      @switch (name()) {
        @case ('dashboard') { <rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/> }
        @case ('documents') { <path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/> }
        @case ('chat') { <path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/> }
        @case ('settings') { <path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/> }
        @case ('upload') { <path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/> }
        @case ('trash') { <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/> }
        @case ('refresh') { <path d="M20 11a8 8 0 0 0-14-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/> }
        @case ('sun') { <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/> }
        @case ('moon') { <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/> }
        @case ('send') { <path d="M4 12l16-8-6 16-3-7z"/> }
        @case ('stop') { <rect x="6" y="6" width="12" height="12" rx="2"/> }
        @case ('plus') { <path d="M12 5v14M5 12h14"/> }
        @case ('chevron') { <path d="M9 6l6 6-6 6"/> }
        @case ('alert') { <path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/> }
        @case ('check') { <path d="M5 12.5l4.5 4.5L19 7.5"/> }
        @case ('menu') { <path d="M4 7h16M4 12h16M4 17h16"/> }
        @case ('close') { <path d="M6 6l12 12M18 6L6 18"/> }
        @case ('eraser') { <path d="M8 20h12M5 14l8-9 6 6-6 7H9z"/> }
        @case ('file') { <path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/> }
        @case ('list') { <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/> }
      }
    </svg>
  `,
  styles: [':host{display:inline-flex;line-height:0;vertical-align:middle}'],
})
export class IconComponent {
  readonly name = input.required<IconName>();
}
