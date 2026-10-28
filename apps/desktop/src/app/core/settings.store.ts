import { Injectable, signal } from '@angular/core';
import type { Settings } from '@statocyst/contracts';
import { bridge } from './bridge';
import { ToastStore } from './toast.store';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  density: 'comfortable',
  volume: 0.85,
  muted: false,
  cacheBudgetBytes: 2 * 1024 * 1024 * 1024,
  quality: 'lossless',
  listeningHistory: false,
};

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  readonly settings = signal<Settings>({ ...DEFAULT_SETTINGS });
  readonly loaded = signal(false);
  private readonly media = window.matchMedia('(prefers-color-scheme: light)');

  constructor(private readonly toasts: ToastStore) {
    this.media.addEventListener('change', () => this.apply());
  }

  async init(): Promise<void> {
    try {
      const settings = await bridge().settings.get();
      this.settings.set(settings);
      this.loaded.set(true);
      this.apply();
    } catch (error) {
      this.toasts.error('Could not load settings', String(error));
      this.apply();
    }
  }

  async update(patch: Partial<Settings>): Promise<void> {
    const next = { ...this.settings(), ...patch };
    this.settings.set(next);
    this.apply();
    try {
      const saved = await bridge().settings.update(patch);
      this.settings.set(saved);
      this.apply();
    } catch (error) {
      this.toasts.error('Could not save settings', String(error));
    }
  }

  private apply(): void {
    const settings = this.settings();
    const root = document.documentElement;
    if (settings.theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', settings.theme);
    }
    const resolved =
      settings.theme === 'system' ? (this.media.matches ? 'light' : 'dark') : settings.theme;
    root.setAttribute('data-resolved-theme', resolved);
    root.setAttribute('data-density', settings.density);
    root.style.colorScheme = resolved;
  }
}
