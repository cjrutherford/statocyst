import { computed, inject, Injectable, signal } from '@angular/core';
import type { Track } from '@statocyst/contracts';
import { LibraryStore } from './library.store';

interface StoredPlaylist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

const STORAGE_KEY = 'statocyst.playlists';

@Injectable({ providedIn: 'root' })
export class PlaylistsStore {
  private readonly library = inject(LibraryStore);

  private readonly playlists = signal<StoredPlaylist[]>(this.load());

  readonly all = this.playlists.asReadonly();
  readonly count = computed(() => this.playlists().length);

  tracksFor(id: string): Track[] {
    const playlist = this.playlists().find((p) => p.id === id);
    if (!playlist) return [];
    const byId = new Map(this.library.tracks().map((track) => [track.id, track]));
    return playlist.trackIds.map((trackId) => byId.get(trackId)).filter((t): t is Track => !!t);
  }

  create(name: string, trackIds: string[]): string {
    const id = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const entry: StoredPlaylist = { id, name: name.trim() || 'Untitled playlist', trackIds: [...new Set(trackIds)], createdAt: Date.now() };
    this.playlists.update((list) => [entry, ...list]);
    this.persist();
    return id;
  }

  rename(id: string, name: string): void {
    this.playlists.update((list) => list.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)));
    this.persist();
  }

  remove(id: string): void {
    this.playlists.update((list) => list.filter((p) => p.id !== id));
    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.playlists()));
    } catch {
      /* ignore quota errors */
    }
  }

  private load(): StoredPlaylist[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((p): p is StoredPlaylist => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.trackIds))
        .map((p) => ({ ...p, trackIds: p.trackIds.filter((v): v is string => typeof v === 'string') }));
    } catch {
      return [];
    }
  }
}
