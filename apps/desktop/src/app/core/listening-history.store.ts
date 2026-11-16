import { computed, effect, inject, Injectable } from '@angular/core';
import type { QueueEntryView } from '@statocyst/contracts';
import {
  recentlyPlayed,
  recommendTracks,
  type PlayedTrack,
  type Recommendation,
} from '@statocyst/recommendation';
import { FavoritesStore } from './favorites.store';
import { LibraryStore } from './library.store';
import { PlaybackStore } from './playback.store';
import { SettingsStore } from './settings.store';

const RECENT_LIMIT = 30;
const RECOMMENDATION_LIMIT = 12;

/**
 * One read model for local listening behaviour. Recently played comes from the
 * history the host already records, and the same rows feed the explainable
 * recommendation slice. Nothing here leaves the device.
 */
@Injectable({ providedIn: 'root' })
export class ListeningHistoryStore {
  private readonly library = inject(LibraryStore);
  private readonly favorites = inject(FavoritesStore);
  private readonly playback = inject(PlaybackStore);
  private readonly settings = inject(SettingsStore);

  private handledChange: QueueEntryView | null = null;

  readonly enabled = computed(() => this.settings.settings().listeningHistory);
  readonly recent = computed<PlayedTrack[]>(() =>
    recentlyPlayed(this.library.tracks(), RECENT_LIMIT),
  );
  readonly recentTracks = computed(() => this.recent().map((entry) => entry.track));
  readonly recommendations = computed<Recommendation[]>(() =>
    recommendTracks({
      tracks: this.library.tracks(),
      favorites: new Set(this.favorites.tracks().map((track) => track.id)),
      recent: this.recent(),
      limit: RECOMMENDATION_LIMIT,
    }),
  );

  constructor() {
    // A `trackChanged` event is a real start; restored or repainted state is not.
    // The host only writes its own history when the setting is on, so mirror that
    // rule locally before updating the catalog signal.
    effect(() => {
      const change = this.playback.lastTrackChange();
      if (!change || change === this.handledChange) return;
      this.handledChange = change;
      if (!this.settings.settings().listeningHistory) return;
      if (change.track.mediaKind === 'podcast' || change.track.sourceKind === 'podcast') return;
      this.library.notePlayed(change.trackId);
    });
  }

  /** Recommendations seeded by songs the user selected from their history. */
  forSeeds(trackIds: readonly string[], limit = RECOMMENDATION_LIMIT): Recommendation[] {
    return recommendTracks({
      tracks: this.library.tracks(),
      favorites: new Set(this.favorites.tracks().map((track) => track.id)),
      recent: this.recent(),
      seedTrackIds: trackIds,
      limit,
    });
  }
}
