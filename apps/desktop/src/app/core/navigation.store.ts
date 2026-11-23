import { computed, Injectable, signal } from '@angular/core';

export type RootView = 'library' | 'playlists' | 'podcasts' | 'offline' | 'settings';
export type View = RootView | 'now' | 'queue';

/** Keeps primary destinations independent and gives transient screens a short return path. */
@Injectable({ providedIn: 'root' })
export class NavigationStore {
  readonly view = signal<View>('library');
  private readonly transientOrigins: View[] = [];
  readonly canGoBack = computed(() => this.view() !== 'library' || this.transientOrigins.length > 0);

  navigate(view: View): void {
    if (view === this.view()) return;
    if (view === 'now' || view === 'queue') {
      this.transientOrigins.push(this.view());
      if (this.transientOrigins.length > 4) this.transientOrigins.shift();
    } else {
      this.transientOrigins.length = 0;
    }
    this.view.set(view);
  }

  back(): boolean {
    const previous = this.peekBack();
    if (!previous) return false;
    this.transientOrigins.pop();
    this.view.set(previous);
    return true;
  }

  peekBack(): View | null {
    const origin = this.transientOrigins[this.transientOrigins.length - 1];
    if (origin) return origin;
    return this.view() === 'library' ? null : 'library';
  }

  clearHistory(): void {
    this.transientOrigins.length = 0;
  }
}
