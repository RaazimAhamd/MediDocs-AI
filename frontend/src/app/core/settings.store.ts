import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { ApiError } from './api-error';
import { ModelDto, SettingsDto } from './models';

const MODEL_KEY = 'medidocs.model';

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly api = inject(ApiService);

  readonly models = signal<ModelDto[]>([]);
  readonly defaultModel = signal<string | null>(null);
  readonly modelsLoading = signal(false);
  readonly modelsError = signal<string | null>(null);
  readonly serverSettings = signal<SettingsDto | null>(null);
  private readonly preferred = signal<string | null>(this.readPreferred());

  /** The model that will actually be used: the saved choice if still installed, else the server default. */
  readonly selectedModel = computed<string | null>(() => {
    const names = this.models().map((m) => m.name);
    const pref = this.preferred();
    if (pref && names.includes(pref)) return pref;
    const def = this.defaultModel();
    if (def && names.includes(def)) return def;
    return names[0] ?? null;
  });

  readonly maxUploadBytes = computed(() => (this.serverSettings()?.maxUploadMb ?? 10) * 1024 * 1024);

  select(name: string): void {
    this.preferred.set(name);
    try {
      localStorage.setItem(MODEL_KEY, name);
    } catch {
      /* storage blocked */
    }
  }

  loadModels(): void {
    this.modelsLoading.set(true);
    this.api.models().subscribe({
      next: (r) => {
        this.models.set(r.models);
        this.defaultModel.set(r.defaultModel);
        this.modelsError.set(null);
        this.modelsLoading.set(false);
      },
      error: (e: ApiError) => {
        this.modelsError.set(e.message);
        this.modelsLoading.set(false);
      },
    });
  }

  loadServerSettings(): void {
    this.api.settings().subscribe({
      next: (s) => this.serverSettings.set(s),
      error: () => undefined,
    });
  }

  private readPreferred(): string | null {
    try {
      return localStorage.getItem(MODEL_KEY);
    } catch {
      return null;
    }
  }
}
