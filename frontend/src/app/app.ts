import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { DocumentsStore } from './core/documents.store';
import { HealthStore } from './core/health.store';
import { SettingsStore } from './core/settings.store';
import { ThemeService } from './core/theme.service';
import { IconComponent } from './shared/icon';
import { ToastContainerComponent } from './shared/toast-container';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, ToastContainerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip" href="#main">Skip to content</a>
    <div class="app" [class.menu-open]="menuOpen()">
      <header class="topbar">
        <button type="button" class="icon-btn" aria-label="Open navigation menu" [attr.aria-expanded]="menuOpen()" (click)="menuOpen.set(!menuOpen())">
          <app-icon [name]="menuOpen() ? 'close' : 'menu'" />
        </button>
        <span class="brand-sm">MediDocs AI</span>
        <span class="dot" [class]="'dot ' + health.state()" [title]="health.label()"></span>
      </header>

      <aside class="sidebar" aria-label="Primary">
        <div class="brand">
          <span class="mark" aria-hidden="true"></span>
          <div>
            <div class="name">MediDocs AI</div>
            <div class="tag">Document assistant</div>
          </div>
        </div>

        <nav>
          @for (item of nav; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: item.path === '/' }">
              <app-icon [name]="item.icon" />
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>

        <div class="foot">
          <div class="status" role="status">
            <span class="dot" [class]="'dot ' + health.state()"></span>
            <span>{{ health.label() }}</span>
          </div>
          <button type="button" class="theme" (click)="theme.toggle()" [attr.aria-label]="'Switch to ' + (theme.theme() === 'dark' ? 'light' : 'dark') + ' theme'">
            <app-icon [name]="theme.theme() === 'dark' ? 'sun' : 'moon'" />
            <span>{{ theme.theme() === 'dark' ? 'Light theme' : 'Dark theme' }}</span>
          </button>
          <p class="note">Local portfolio demo. Fictional or public documents only. Not medical advice. No sign-in.</p>
        </div>
      </aside>
      <div class="backdrop" (click)="menuOpen.set(false)" aria-hidden="true"></div>

      <main id="main" class="content" tabindex="-1">
        <router-outlet />
      </main>
    </div>
    <app-toast-container />
  `,
  styles: [`
    .skip{position:absolute;left:-999px;top:8px;background:var(--sheet);padding:8px 12px;border-radius:6px;z-index:200}
    .skip:focus{left:8px}
    .app{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh;min-height:100dvh}
    .sidebar{position:sticky;top:0;height:100vh;height:100dvh;background:var(--sidebar-bg);color:var(--sidebar-text);display:flex;flex-direction:column;padding:20px 14px;gap:22px;overflow-y:auto}
    .brand{display:flex;align-items:center;gap:12px;padding:0 6px}
    .mark{width:34px;height:34px;border-radius:7px;background:#fff;position:relative;flex:none}
    .mark::after{content:'';position:absolute;left:7px;right:7px;top:16px;height:7px;border-radius:2px;background:#ffe066}
    :root[data-theme='dark'] .mark{background:#e6eaf2}
    .name{font-family:var(--font-doc);font-size:1.2rem;font-weight:600;color:#fff;line-height:1.1}
    .tag{font-size:.78rem;color:var(--sidebar-text);margin-top:2px}
    nav{display:flex;flex-direction:column;gap:2px}
    nav a{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:6px;color:var(--sidebar-text);text-decoration:none;font-weight:600;font-size:.93rem}
    nav a:hover{background:rgba(255,255,255,.06);color:#fff}
    nav a.active{background:var(--sidebar-active);color:#fff;box-shadow:inset 3px 0 0 #ffe066}
    nav a:focus-visible,.theme:focus-visible{box-shadow:0 0 0 3px rgba(255,224,102,.55)}
    .foot{margin-top:auto;display:flex;flex-direction:column;gap:12px}
    .status{display:flex;align-items:center;gap:10px;font-size:.88rem;padding:0 6px;color:#fff}
    .theme{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:6px;cursor:pointer;font-size:.9rem;font-weight:600}
    .theme:hover{background:rgba(255,255,255,.06);color:#fff}
    .note{font-size:.76rem;line-height:1.45;padding:0 6px;color:var(--sidebar-text);opacity:.85}
    .dot{width:10px;height:10px;border-radius:50%;background:#8a94a8;flex:none}
    .dot.online{background:#4ade80}.dot.models-missing{background:#fbbf24}.dot.ollama-offline,.dot.backend-offline{background:#f87171}
    .content{min-width:0}
    .content:focus{outline:none}
    .topbar,.backdrop{display:none}
    @media (max-width:900px){
      .app{display:block}
      .topbar{display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:30;height:52px;padding:0 10px;background:var(--sheet);border-bottom:1px solid var(--rule)}
      .brand-sm{font-family:var(--font-doc);font-weight:600;font-size:1.1rem;flex:1}
      .sidebar{position:fixed;left:0;top:0;bottom:0;width:264px;z-index:50;transform:translateX(-100%);transition:transform .2s ease}
      .menu-open .sidebar{transform:none}
      .menu-open .backdrop{display:block;position:fixed;inset:0;background:rgba(8,16,32,.5);z-index:40}
    }
  `],
})
export class App {
  protected readonly health = inject(HealthStore);
  protected readonly theme = inject(ThemeService);
  private readonly documents = inject(DocumentsStore);
  private readonly settings = inject(SettingsStore);
  protected readonly menuOpen = signal(false);

  protected readonly nav = [
    { path: '/', label: 'Dashboard', icon: 'dashboard' },
    { path: '/documents', label: 'Documents', icon: 'documents' },
    { path: '/chat', label: 'Ask questions', icon: 'chat' },
    { path: '/settings', label: 'Settings', icon: 'settings' },
  ] as const;

  constructor() {
    const router = inject(Router);
    const destroyRef = inject(DestroyRef);

    this.health.start();
    this.settings.loadServerSettings();
    this.settings.loadModels();
    this.documents.load();

    // If Ollama is started after the app, pick up the installed models as soon as it becomes ready.
    effect(() => {
      if (this.health.state() === 'online' && this.settings.models().length === 0) {
        untracked(() => {
          if (!this.settings.modelsLoading()) this.settings.loadModels();
        });
      }
    });

    const sub = router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.menuOpen.set(false));
    destroyRef.onDestroy(() => {
      sub.unsubscribe();
      this.health.stop();
      this.documents.stop();
    });
  }
}
