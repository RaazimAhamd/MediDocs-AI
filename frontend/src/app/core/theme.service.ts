import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';
const KEY = 'medidocs.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>('light');

  init(): void {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      /* storage blocked */
    }
    const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    this.apply(stored === 'dark' || stored === 'light' ? stored : prefersDark ? 'dark' : 'light', false);
  }

  toggle(): void {
    this.apply(this.theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme): void {
    this.apply(theme);
  }

  private apply(theme: Theme, persist = true): void {
    this.theme.set(theme);
    document.documentElement.dataset['theme'] = theme;
    if (persist) {
      try {
        localStorage.setItem(KEY, theme);
      } catch {
        /* storage blocked */
      }
    }
  }
}
