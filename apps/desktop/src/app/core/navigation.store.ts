import { computed, Injectable, signal } from '@angular/core';

export type View = 'library' | 'offline' | 'playlists' | 'now' | 'queue' | 'settings';

/**
 * Single owner of app navigation. Keeps a linear back stack so Android's
 * hardware back button (and any in-app "back" affordance) can return to the
 * previously viewed section instead of exiting.
 */
@Injectable({ providedIn: 'root' })
export class NavigationStore {
  readonly view = signal<View>('library');
  private readonly history: View[] = [];
  readonly canGoBack = computed(() => this.history.length > 0);

  navigate(view: View): void {
    if (view === this.view()) return;
    this.history.push(this.view());
    // Bound the stack so it never grows without limit.
    if (this.history.length > 20) this.history.shift();
    this.view.set(view);
  }

  /** Returns true when it moved back; false when there is nothing to go back to. */
  back(): boolean {
    const previous = this.history.pop();
    if (!previous) return false;
    this.view.set(previous);
    return true;
  }

  clearHistory(): void {
    this.history.length = 0;
  }
}
