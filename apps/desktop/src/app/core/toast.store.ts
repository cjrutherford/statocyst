import { Injectable, signal } from '@angular/core';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
}

@Injectable({ providedIn: 'root' })
export class ToastStore {
  private counter = 0;
  readonly toasts = signal<Toast[]>([]);

  push(message: string, kind: ToastKind = 'info', detail?: string, ttl = 6000): void {
    this.counter += 1;
    const toast: Toast = { id: this.counter, kind, message, ...(detail ? { detail } : {}) };
    this.toasts.update((current) => [...current.slice(-3), toast]);
    if (ttl > 0) {
      setTimeout(() => this.dismiss(toast.id), ttl);
    }
  }

  success(message: string, detail?: string): void {
    this.push(message, 'success', detail);
  }

  error(message: string, detail?: string): void {
    this.push(message, 'error', detail, 9000);
  }

  dismiss(id: number): void {
    this.toasts.update((current) => current.filter((toast) => toast.id !== id));
  }
}
