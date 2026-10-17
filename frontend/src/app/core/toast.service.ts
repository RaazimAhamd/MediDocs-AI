import { Injectable, signal } from '@angular/core';
import { uid } from './format';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);

  show(kind: ToastKind, message: string, ttlMs = kind === 'error' ? 8000 : 4500): string {
    const toast: Toast = { id: uid(), kind, message };
    this.toasts.update((list) => [...list.slice(-3), toast]);
    if (ttlMs > 0) setTimeout(() => this.dismiss(toast.id), ttlMs);
    return toast.id;
  }

  success(message: string): string {
    return this.show('success', message);
  }
  error(message: string): string {
    return this.show('error', message);
  }
  info(message: string): string {
    return this.show('info', message);
  }

  dismiss(id: string): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
