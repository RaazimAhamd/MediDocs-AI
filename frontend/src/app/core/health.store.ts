import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { ApiError } from './api-error';
import { HealthDto } from './models';

export type AssistantState = 'checking' | 'online' | 'models-missing' | 'ollama-offline' | 'backend-offline';

@Injectable({ providedIn: 'root' })
export class HealthStore {
  private readonly api = inject(ApiService);
  private timer?: ReturnType<typeof setInterval>;

  readonly health = signal<HealthDto | null>(null);
  readonly backendError = signal<string | null>(null);
  readonly checking = signal(false);

  readonly state = computed<AssistantState>(() => {
    if (this.backendError()) return 'backend-offline';
    const h = this.health();
    if (!h) return 'checking';
    if (!h.ollama.reachable) return 'ollama-offline';
    return h.ollama.ready ? 'online' : 'models-missing';
  });

  readonly label = computed(() => {
    switch (this.state()) {
      case 'online':
        return 'Assistant ready';
      case 'models-missing':
        return 'Model missing';
      case 'ollama-offline':
        return 'Ollama not running';
      case 'backend-offline':
        return 'Backend not running';
      default:
        return 'Checking status';
    }
  });

  refresh(): void {
    this.checking.set(true);
    this.api.health().subscribe({
      next: (h) => {
        this.health.set(h);
        this.backendError.set(null);
        this.checking.set(false);
      },
      error: (e: ApiError) => {
        this.backendError.set(e.message);
        this.checking.set(false);
      },
    });
  }

  start(intervalMs = 15000): void {
    this.refresh();
    this.stop();
    this.timer = setInterval(() => this.refresh(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
