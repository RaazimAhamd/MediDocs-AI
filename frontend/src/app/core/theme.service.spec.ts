import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
  });

  it('applies and persists the chosen theme', () => {
    const theme = TestBed.inject(ThemeService);
    theme.init();
    theme.set('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem('medidocs.theme')).toBe('dark');
    theme.toggle();
    expect(theme.theme()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('restores a saved theme on init', () => {
    localStorage.setItem('medidocs.theme', 'dark');
    const theme = TestBed.inject(ThemeService);
    theme.init();
    expect(theme.theme()).toBe('dark');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('medidocs.theme', 'purple');
    const theme = TestBed.inject(ThemeService);
    theme.init();
    expect(['light', 'dark']).toContain(theme.theme());
  });
});
