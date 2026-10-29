import { inject, Injectable } from '@angular/core';
import { buildRadio } from '@statocyst/playback-core';
import type { Track } from '@statocyst/contracts';
import { bridge, bridgeAvailable } from './bridge';
import { FavoritesStore } from './favorites.store';
import { LibraryStore } from './library.store';
import { PlaybackStore } from './playback.store';
import { PlaylistsStore } from './playlists.store';
import { ToastStore } from './toast.store';

/** Song radio: pick a song and get a queue (or a saved playlist) of similar songs from the library. */
@Injectable({ providedIn: 'root' })
export class RadioStore {
  private readonly library = inject(LibraryStore);
  private readonly playback = inject(PlaybackStore);
  private readonly playlists = inject(PlaylistsStore);
  private readonly favorites = inject(FavoritesStore);
  private readonly toasts = inject(ToastStore);

  /** The seed first, then similar songs. Android asks the plugin; elsewhere the local scorer runs. */
  async tracksFor(seed: Track): Promise<string[]> {
    const native = bridgeAvailable() ? bridge().radio : undefined;
    if (native) {
      try {
        const result = await native.call(bridge(), { trackId: seed.id });
        if (result.trackIds.length > 0) return result.trackIds;
      } catch {
        /* fall back to the local scorer */
      }
    }
    const isFavorite = this.favorites.isFavorite();
    const favorites = new Set(this.library.tracks().filter((t) => isFavorite(t.id)).map((t) => t.id));
    const similar = buildRadio(seed, this.library.tracks(), favorites);
    return [seed.id, ...similar];
  }

  async start(seed: Track): Promise<void> {
    const ids = await this.tracksFor(seed);
    if (ids.length <= 1) {
      this.toasts.error('Not enough songs for a radio', 'Add more music to your library first.');
      return;
    }
    if (this.playback.snapshot().shuffle) await this.playback.toggleShuffle();
    await this.playback.playTrack(seed.id, ids);
    this.toasts.success(`${seed.title} Radio`, `${ids.length - 1} similar songs queued`);
  }

  async saveAsPlaylist(seed: Track): Promise<void> {
    const ids = await this.tracksFor(seed);
    if (ids.length <= 1) {
      this.toasts.error('Not enough songs for a radio', 'Add more music to your library first.');
      return;
    }
    this.playlists.create(`${seed.title} Radio`, ids);
    this.toasts.success('Saved as playlist', `${seed.title} Radio · ${ids.length} songs`);
  }
}
