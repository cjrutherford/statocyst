import { computed, inject, Injectable, signal } from '@angular/core';
import type { Track } from '@statocyst/contracts';
import { LibraryStore } from './library.store';
import { initNativeUserState, pushNativeUserState } from './native-user-state';

const STORAGE_KEY = 'statocyst.favorites';

@Injectable({ providedIn: 'root' })
export class FavoritesStore {
  private readonly library = inject(LibraryStore);
  private readonly ids = signal<Set<string>>(this.load());

  constructor() {
    initNativeUserState([...this.ids()], (ids) => this.adopt(ids));
  }

  /** Favorites changed natively (the car): take them as the truth. */
  private adopt(ids: string[]): void {
    this.ids.set(new Set(ids));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      /* ignore quota errors */
    }
  }

  readonly favoriteIds = this.ids.asReadonly();
  /** Favorited under this id or under a copy of the same recording on another server. */
  readonly isFavorite = computed(() => {
    const set = this.ids();
    const library = this.library;
    return (trackId: string) => {
      const id = library.canonicalId(trackId);
      return set.has(id) || set.has(trackId) || (library.aliasesOf(id).some((alias) => set.has(alias)));
    };
  });
  readonly tracks = computed<Track[]>(() => {
    const isFavorite = this.isFavorite();
    return this.library.tracks().filter((track) => isFavorite(track.id));
  });
  readonly count = computed(() => this.tracks().length);

  toggle(trackId: string): void {
    const next = new Set(this.ids());
    const id = this.library.canonicalId(trackId);
    const family = [id, trackId, ...this.library.aliasesOf(id)];
    if (family.some((member) => next.has(member))) for (const member of family) next.delete(member);
    else next.add(id);
    this.ids.set(next);
    pushNativeUserState({ favorites: [...next] });
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
