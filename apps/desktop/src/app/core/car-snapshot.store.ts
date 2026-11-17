import { DestroyRef, effect, inject, Injectable } from '@angular/core';
import type { CarRecommendationSnapshot } from '@statocyst/contracts';
import { buildCarRecommendationSnapshot } from '@statocyst/recommendation';
import { FavoritesStore } from './favorites.store';
import { LibraryStore } from './library.store';
import { ListeningHistoryStore } from './listening-history.store';
import { pushNativeUserState } from './native-user-state';

const PUSH_DEBOUNCE_MS = 700;

/**
 * Publishes the renderer's recommendation snapshot to the native car surfaces.
 * Android Auto, CarPlay and AAOS have no WebView, so they read this versioned
 * snapshot instead of running the TypeScript recommender.
 */
@Injectable({ providedIn: 'root' })
export class CarSnapshotStore {
  private readonly library = inject(LibraryStore);
  private readonly favorites = inject(FavoritesStore);
  private readonly history = inject(ListeningHistoryStore);
  private readonly destroyRef = inject(DestroyRef);

  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastKey = '';

  constructor() {
    effect(() => {
      if (!this.library.loaded()) return;
      const snapshot = buildCarRecommendationSnapshot({
        tracks: this.library.tracks(),
        favorites: new Set(this.favorites.tracks().map((track) => track.id)),
        recent: this.history.recent(),
      });
      const key = JSON.stringify(snapshot.mixes);
      if (key === this.lastKey) return;
      this.lastKey = key;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.publish(snapshot), PUSH_DEBOUNCE_MS);
    });

    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
  }

  private publish(snapshot: CarRecommendationSnapshot): void {
    // `native-user-state` is a no-op outside the mobile shell.
    pushNativeUserState({ carRecommendations: snapshot });
  }
}
