import { computed, inject, Injectable, signal } from '@angular/core';
import type { Track } from '@statocyst/contracts';
import { LibraryStore } from './library.store';

const STORAGE_KEY = 'statocyst.favorites';

@Injectable({ providedIn: 'root' })
export class FavoritesStore {
  private readonly library = inject(LibraryStore);
  private readonly ids = signal<Set<string>>(this.load());

  readonly favoriteIds = this.ids.asReadonly();
  readonly isFavorite = computed(() => {
    const set = this.ids();
    return (trackId: string) => set.has(trackId);
  });
  readonly tracks = computed<Track[]>(() =>
    this.library.tracks().filter((track) => this.ids().has(track.id)),
  );
  readonly count = computed(() => this.ids().size);

  toggle(trackId: string): void {
    const next = new Set(this.ids());
    if (next.has(trackId)) next.delete(trackId);
    else next.add(trackId);
    this.ids.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore quota errors */
    }
  }

  private load(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((v): v is string => typeof v === 'string'));
    } catch {
      return new Set();
    }
  }
}
