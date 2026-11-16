import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { Track } from '@statocyst/contracts';
import type { Recommendation } from '@statocyst/recommendation';
import { ArtworkComponent } from '../components/artwork.component';
import { IconComponent } from '../components/icon.component';
import { LibraryStore } from '../core/library.store';
import { FavoritesStore } from '../core/favorites.store';
import { PlaylistsStore } from '../core/playlists.store';
import { DownloadsStore } from '../core/downloads.store';
import { PlaybackStore } from '../core/playback.store';
import { ListeningHistoryStore } from '../core/listening-history.store';
import { NavigationStore } from '../core/navigation.store';
import { ToastStore } from '../core/toast.store';
import { formatDuration } from '../core/format';

interface RecommendedItem {
  track: Track;
  recommendation: Recommendation;
}

@Component({
  selector: 'sc-playlists-view',
  standalone: true,
  imports: [ArtworkComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="view" aria-labelledby="playlists-heading">
      <header class="view__head">
        <div>
          <p class="eyebrow">Your mixes</p>
          <h1 id="playlists-heading">Playlists</h1>
          <p class="lede">
            Smart lists and mixes built from your library. Favorites, recently played and
            recommendations stay on this device; nothing is uploaded.
          </p>
        </div>
        <div class="actions">
          <button type="button" class="btn btn--quiet" [disabled]="favorites().length === 0" (click)="saveFavorites()">Save favorites as playlist</button>
          <button type="button" class="btn btn--quiet" [disabled]="history.recentTracks().length === 0" (click)="saveRecentlyPlayed()">Save recently played</button>
          <button type="button" class="btn btn--primary" (click)="createSmartPlaylist()">New smart playlist</button>
        </div>
      </header>

      <div class="smart-grid">
        <div class="smart-card">
          <button type="button" class="smart-card__play" (click)="playList(favorites())" [disabled]="favorites().length === 0">
            <sc-icon name="sparkles" />
            <span class="smart-card__name">Favorites</span>
            <span class="smart-card__count">{{ favorites().length }} track{{ favorites().length === 1 ? '' : 's' }}</span>
          </button>
          @if (downloads.supported && favorites().length > 0) {
            <button type="button" class="smart-card__download" aria-label="Download favorites" (click)="downloadIds(favorites().map(t => t.id))">
              <sc-icon name="download" />
            </button>
          }
        </div>
        <div class="smart-card">
          <button type="button" class="smart-card__play" (click)="playList(history.recentTracks())" [disabled]="history.recentTracks().length === 0">
            <sc-icon name="wave" />
            <span class="smart-card__name">Recently played</span>
            <span class="smart-card__count">{{ history.recentTracks().length }} track{{ history.recentTracks().length === 1 ? '' : 's' }}</span>
          </button>
          @if (downloads.supported && history.recentTracks().length > 0) {
            <button type="button" class="smart-card__download" aria-label="Download recently played" (click)="downloadIds(history.recentTracks().map(t => t.id))">
              <sc-icon name="download" />
            </button>
          }
        </div>
        <div class="smart-card">
          <button type="button" class="smart-card__play" (click)="playRecommendations()" [disabled]="recommendedTracks().length === 0">
            <sc-icon name="sparkles" />
            <span class="smart-card__name">For you</span>
            <span class="smart-card__count">{{ recommendedTracks().length }} pick{{ recommendedTracks().length === 1 ? '' : 's' }}</span>
          </button>
        </div>
        <button type="button" class="smart-card smart-card--play" (click)="playAllShuffled()" [disabled]="library.tracks().length === 0">
          <sc-icon name="shuffle" />
          <span class="smart-card__name">Shuffle all</span>
          <span class="smart-card__count">{{ library.tracks().length }} tracks</span>
        </button>
      </div>

      <div class="list-block">
        <h2>Favorites</h2>
        @if (favorites().length === 0) {
          <p class="empty-hint">Star tracks in the Library to collect them here.</p>
        } @else {
          <ul class="mini-list">
            @for (track of favorites(); track track.id) {
              <li>
                <button type="button" class="mini-row" (click)="play(track)">
                  <sc-artwork [src]="track.artworkUrl" [altText]="track.title" size="sm" />
                  <span class="mini-text">
                    <span class="mini-title">{{ track.title }}</span>
                    <span class="mini-artist">{{ track.artist }}</span>
                  </span>
                  <span class="mini-duration">{{ formatDuration(track.durationMs) }}</span>
                </button>
                <button type="button" class="icon-btn" aria-label="Remove from favorites" (click)="favoritesStore.toggle(track.id)">
                  <sc-icon name="close" />
                </button>
              </li>
            }
          </ul>
        }
      </div>

      <div class="list-block">
        <h2>Saved playlists</h2>
        @if (playlistsStore.all().length === 0) {
          <p class="empty-hint">Select tracks in the Library and choose "Save as playlist".</p>
        } @else {
          <ul class="mini-list">
            @for (playlist of playlistsStore.all(); track playlist.id) {
              <li>
                <button type="button" class="mini-row" (click)="playPlaylist(playlist.id)">
                  <sc-icon name="queue" />
                  <span class="mini-text">
                    <span class="mini-title">{{ playlist.name }}</span>
                    <span class="mini-artist">{{ playlist.trackIds.length }} track{{ playlist.trackIds.length === 1 ? '' : 's' }}</span>
                  </span>
                </button>
                @if (downloads.supported) {
                  <button type="button" class="icon-btn" aria-label="Download playlist" (click)="downloadPlaylist(playlist.id)">
                    <sc-icon name="download" />
                  </button>
                }
                <button type="button" class="icon-btn" aria-label="Remove playlist" (click)="playlistsStore.remove(playlist.id)">
                  <sc-icon name="trash" />
                </button>
              </li>
            }
          </ul>
        }
      </div>

      <div class="list-block">
        <div class="list-head">
          <div>
            <h2>Recently played</h2>
            @if (history.recentTracks().length > 0) {
              <p class="list-hint">Newest first · stored on this device</p>
            }
          </div>
          @if (history.recentTracks().length > 0) {
            <span class="list-count">{{ history.recentTracks().length }} track{{ history.recentTracks().length === 1 ? '' : 's' }}</span>
          }
        </div>

        @if (history.recentTracks().length === 0) {
          @if (history.enabled()) {
            <p class="empty-hint">Play a song and it will appear here.</p>
          } @else {
            <p class="empty-hint">
              Listening history is off. Turn it on in Settings to keep a list of what you have
              played and to improve your mixes.
            </p>
            <button type="button" class="btn btn--quiet" (click)="openHistorySettings()">Open privacy settings</button>
          }
        } @else {
          @if (!history.enabled()) {
            <p class="empty-hint">
              History is paused. Existing plays stay visible; turn it back on in Settings to keep
              recording new ones.
            </p>
          }

          @if (recentSelection().size > 0) {
            <div class="selection-bar" role="toolbar" aria-label="Recently played selection actions">
              <span class="selection-count">{{ recentSelection().size }} selected</span>
              <button type="button" class="btn btn--quiet" (click)="playSelectedRecent()">
                <sc-icon name="play" /> Play
              </button>
              <button type="button" class="btn btn--quiet" (click)="saveSelectedRecent()">
                <sc-icon name="plus" /> Save as playlist
              </button>
              <button type="button" class="btn btn--quiet" (click)="mixFromSelected()">
                <sc-icon name="sparkles" /> Mix from selected
              </button>
              <button type="button" class="btn btn--quiet" (click)="clearRecentSelection()">
                <sc-icon name="close" /> Clear
              </button>
            </div>
          }

          <ul class="mini-list">
            @for (entry of history.recent(); track entry.track.id) {
              <li [class.is-selected]="recentSelection().has(entry.track.id)">
                <label class="mini-check">
                  <input
                    type="checkbox"
                    [checked]="recentSelection().has(entry.track.id)"
                    (change)="toggleRecentSelection(entry.track.id, $event)"
                    [attr.aria-label]="'Select ' + entry.track.title"
                  />
                </label>
                <button type="button" class="mini-row" (click)="play(entry.track)">
                  <sc-artwork [src]="entry.track.artworkUrl" [altText]="entry.track.title" size="sm" />
                  <span class="mini-text">
                    <span class="mini-title">{{ entry.track.title }}</span>
                    <span class="mini-artist">{{ entry.track.artist }}</span>
                  </span>
                </button>
                <span class="mini-meta">
                  <span class="mini-when">{{ playedAgo(entry.playedAt) }}</span>
                </span>
                <button
                  type="button"
                  class="icon-btn"
                  [class.is-active]="favoritesStore.isFavorite()(entry.track.id)"
                  [attr.aria-pressed]="favoritesStore.isFavorite()(entry.track.id)"
                  aria-label="Toggle favorite"
                  (click)="favoritesStore.toggle(entry.track.id)"
                >
                  <sc-icon name="offline" />
                </button>
              </li>
            }
          </ul>
        }
      </div>

      <div class="list-block">
        <div class="list-head">
          <div>
            <h2>For you</h2>
            <p class="list-hint">
              @if (mixSeeds().length > 0) {
                Seeded by {{ mixSeeds().length }} selected track{{ mixSeeds().length === 1 ? '' : 's' }}.
              } @else {
                A first explainable mix from your favorites, recent plays and track metadata.
              }
            </p>
          </div>
          @if (recommendedTracks().length > 0) {
            <div class="list-actions">
              <button type="button" class="btn btn--quiet" (click)="playRecommendations()">
                <sc-icon name="play" /> Play mix
              </button>
              <button type="button" class="btn btn--quiet" (click)="saveRecommendations()">
                <sc-icon name="plus" /> Save as playlist
              </button>
              @if (mixSeeds().length > 0) {
                <button type="button" class="btn btn--quiet" (click)="clearMixSeeds()">
                  <sc-icon name="close" /> Clear seeds
                </button>
              }
            </div>
          }
        </div>

        @if (recommendedTracks().length === 0) {
          <p class="empty-hint">Add music, or play something different, to get your first mix.</p>
        } @else {
          <ul class="mini-list mini-list--reasons">
            @for (item of recommendedTracks(); track item.track.id) {
              <li>
                <button
                  type="button"
                  class="mini-row"
                  [attr.aria-label]="'Play ' + item.track.title + ' by ' + item.track.artist + '. ' + reasonFor(item.recommendation)"
                  (click)="play(item.track)"
                >
                  <sc-artwork [src]="item.track.artworkUrl" [altText]="item.track.title" size="sm" />
                  <span class="mini-text">
                    <span class="mini-title">{{ item.track.title }}</span>
                    <span class="mini-artist">{{ item.track.artist }}</span>
                  </span>
                </button>
                <span class="reason-chip" [attr.title]="item.recommendation.confidence + ' confidence'">
                  {{ reasonFor(item.recommendation) }}
                </span>
              </li>
            }
          </ul>
        }
      </div>

      <p class="note">
        Recently played comes from the local listening history you enable in Settings. For you is an
        early, explainable mix built on this device; acoustic analysis and richer recommendation
        models remain planned.
      </p>
    </section>
  `,
  styles: [
    `
      .view { display: grid; gap: clamp(16px, 2vw, 26px); padding: clamp(20px, 3vw, 38px); max-width: 1480px; margin: 0 auto; animation: rise 380ms ease both; }
      .view__head { display: flex; flex-direction: column; gap: 4px; }
      .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      @media (max-width: 640px) {
        .actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
        }
        .actions .btn:last-child {
          grid-column: 1 / -1;
        }
        .smart-card__download {
          width: 44px;
          height: 44px;
        }
      }
      h1 { font-size: clamp(2rem, 3.4vw, 3rem); letter-spacing: -0.03em; margin: 4px 0 6px; }
      .lede { color: var(--muted); max-width: 58ch; margin: 0; font-size: 0.92rem; }
      .smart-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
      .smart-card { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 16px; border-radius: 14px; border: 1px solid var(--line); background: rgba(255,255,255,0.03); }
      .smart-card__play { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; border: none; background: transparent; color: var(--text); cursor: pointer; text-align: left; padding: 0; width: 100%; }
      .smart-card__play:disabled { opacity: 0.5; cursor: not-allowed; }
      .smart-card--play { cursor: pointer; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; text-align: left; color: var(--text); }
      .smart-card sc-icon { width: 22px; height: 22px; color: var(--cyan); }
      .smart-card__name { font-weight: 600; }
      .smart-card__count { color: var(--muted); font-size: 0.78rem; }
      .smart-card__download { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; display: inline-grid; place-items: center; }
      .smart-card__download:hover { color: var(--cyan); border-color: var(--cyan); }
      .list-block { display: grid; gap: 10px; }
      .list-block h2 { font-size: 1.1rem; margin: 0; }
      .list-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 8px 14px; }
      .list-hint { color: var(--muted); font-size: 0.78rem; margin: 2px 0 0; }
      .list-count { color: var(--muted); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
      .list-actions { display: flex; flex-wrap: wrap; gap: 6px; }
      .empty-hint { color: var(--muted); font-size: 0.86rem; margin: 0; }
      .mini-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
      .mini-list li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 12px; border: 1px solid var(--line); background: rgba(255,255,255,0.02); }
      .mini-list li.is-selected { border-color: var(--cyan); background: rgba(75, 213, 238, 0.08); }
      .mini-check { display: inline-grid; place-items: center; width: 24px; height: 24px; flex: none; }
      .mini-check input { width: 18px; height: 18px; accent-color: var(--cyan); cursor: pointer; }
      .mini-row { display: flex; align-items: center; gap: 10px; flex: 1; background: none; border: none; color: inherit; cursor: pointer; padding: 0; text-align: left; min-width: 0; }
      .mini-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .mini-title { font-weight: 600; font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mini-artist { color: var(--muted); font-size: 0.76rem; }
      .mini-duration { color: var(--muted); font-size: 0.76rem; font-variant-numeric: tabular-nums; }
      .mini-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; flex: none; text-align: right; }
      .mini-when { color: var(--muted); font-size: 0.74rem; }
      .reason-chip { max-width: 34ch; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); font-size: 0.72rem; line-height: 1.25; }
      .selection-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 12px; border: 1px solid var(--cyan); background: rgba(75, 213, 238, 0.06); }
      .selection-count { font-size: 0.82rem; font-weight: 600; }
      .icon-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; display: inline-grid; place-items: center; }
      .icon-btn.is-active { color: var(--cyan); border-color: var(--cyan); }
      .note { color: var(--muted); font-size: 0.78rem; max-width: 70ch; }
      @media (max-width: 720px), (pointer: coarse) {
        .mini-check { width: 44px; height: 44px; }
      }
      @media (max-width: 640px) {
        .list-actions { width: 100%; }
        .list-actions .btn { flex: 1; }
        .mini-list--reasons li { flex-wrap: wrap; }
        .mini-list--reasons .mini-row { flex-basis: 100%; }
        .mini-list--reasons .reason-chip { max-width: none; margin-left: 44px; }
        .mini-when { display: none; }
      }
    `,
  ],
})
export class PlaylistsViewComponent {
  protected readonly formatDuration = formatDuration;
  protected readonly library = inject(LibraryStore);
  protected readonly favoritesStore = inject(FavoritesStore);
  protected readonly playlistsStore = inject(PlaylistsStore);
  protected readonly downloads = inject(DownloadsStore);
  protected readonly playback = inject(PlaybackStore);
  protected readonly history = inject(ListeningHistoryStore);
  private readonly navigation = inject(NavigationStore);
  private readonly toasts = inject(ToastStore);

  protected readonly favorites = this.favoritesStore.tracks;
  protected readonly recentSelection = signal<Set<string>>(new Set());
  protected readonly mixSeeds = signal<string[]>([]);

  private readonly tracksById = computed(
    () => new Map(this.library.tracks().map((track) => [track.id, track])),
  );

  protected readonly recommendedTracks = computed<RecommendedItem[]>(() => {
    const byId = this.tracksById();
    const seeds = this.mixSeeds();
    const recommendations = seeds.length > 0
      ? this.history.forSeeds(seeds)
      : this.history.recommendations();
    return recommendations
      .map((recommendation) => {
        const track = byId.get(recommendation.trackId);
        return track ? { track, recommendation } : null;
      })
      .filter((item): item is RecommendedItem => item !== null);
  });

  protected play(track: Track): void {
    void this.playback.playTrack(track.id);
  }

  protected playedAgo(playedAt: string): string {
    const at = Date.parse(playedAt);
    if (!Number.isFinite(at)) return 'Recently';
    const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return new Date(at).toLocaleDateString();
  }

  protected reasonFor(recommendation: Recommendation): string {
    return recommendation.reasons[0]?.label ?? 'A fresh pick from your library';
  }

  protected toggleRecentSelection(trackId: string, event: Event): void {
    event.stopPropagation();
    this.recentSelection.update((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

  protected clearRecentSelection(): void {
    this.recentSelection.set(new Set());
  }

  protected openHistorySettings(): void {
    this.navigation.navigate('settings');
  }

  protected saveFavorites(): void {
    const ids = this.favoritesStore.tracks().map((t) => t.id);
    if (ids.length === 0) return;
    const name = window.prompt('Name this playlist', 'Favorites');
    if (!name) return;
    this.playlistsStore.create(name, ids);
    this.toasts.success('Playlist saved', name);
  }

  protected saveRecentlyPlayed(): void {
    const ids = this.history.recentTracks().map((t) => t.id);
    if (ids.length === 0) return;
    const name = window.prompt('Name this playlist', 'Recently played');
    if (!name) return;
    this.playlistsStore.create(name, ids);
    this.toasts.success('Playlist saved', name);
  }

  protected saveSelectedRecent(): void {
    const selected = this.recentSelection();
    const ids = this.history.recentTracks().filter((t) => selected.has(t.id)).map((t) => t.id);
    if (ids.length === 0) return;
    const name = window.prompt('Name this playlist', `Recently played (${ids.length})`);
    if (!name) return;
    this.playlistsStore.create(name, ids);
    this.toasts.success('Playlist saved', name);
    this.clearRecentSelection();
  }

  protected playSelectedRecent(): void {
    const selected = this.recentSelection();
    this.playList(this.history.recentTracks().filter((t) => selected.has(t.id)));
  }

  protected mixFromSelected(): void {
    const selected = this.recentSelection();
    const ids = this.history.recentTracks().filter((t) => selected.has(t.id)).map((t) => t.id);
    if (ids.length === 0) return;
    this.mixSeeds.set(ids);
    this.toasts.success('Mix updated', `Seeded by ${ids.length} track${ids.length === 1 ? '' : 's'}`);
  }

  protected clearMixSeeds(): void {
    this.mixSeeds.set([]);
  }

  protected playRecommendations(): void {
    this.playList(this.recommendedTracks().map((item) => item.track));
  }

  protected saveRecommendations(): void {
    const ids = this.recommendedTracks().map((item) => item.track.id);
    if (ids.length === 0) return;
    const name = window.prompt(
      'Name this mix',
      this.mixSeeds().length > 0 ? 'Mix from selection' : 'For you',
    );
    if (!name) return;
    this.playlistsStore.create(name, ids);
    this.toasts.success('Playlist saved', name);
  }

  protected createSmartPlaylist(): void {
    const criterion = window.prompt('Filter by artist or album (leave blank for all)', '');
    const name = window.prompt('Name this smart playlist', criterion ? `Smart: ${criterion}` : 'Smart playlist');
    if (!name) return;
    const term = (criterion ?? '').trim().toLowerCase();
    const tracks = term
      ? this.library.tracks().filter((t) =>
          [t.title, t.artist, t.album, t.albumArtist ?? ''].join(' ').toLowerCase().includes(term),
        )
      : [...this.library.tracks()];
    if (tracks.length === 0) {
      window.alert('No tracks matched that filter.');
      return;
    }
    this.playlistsStore.create(name, tracks.map((t) => t.id));
    this.toasts.success('Playlist saved', name);
  }

  protected downloadIds(ids: string[]): void {
    const tracks = this.library.tracks().filter((t) => ids.includes(t.id));
    void this.downloads.downloadMany(ids, (id) => tracks.find((t) => t.id === id)?.title ?? '');
  }

  protected downloadPlaylist(id: string): void {
    this.downloadIds(this.playlistsStore.tracksFor(id).map((t) => t.id));
  }

  protected playPlaylist(id: string): void {
    const tracks = this.playlistsStore.tracksFor(id);
    if (tracks.length === 0) return;
    void this.playback.playTrack(tracks[0].id, tracks.map((t) => t.id));
  }

  protected playList(tracks: Track[]): void {
    if (tracks.length === 0) return;
    void this.playback.playTrack(tracks[0].id, tracks.map((t) => t.id));
  }

  protected playAllShuffled(): void {
    const tracks = [...this.library.tracks()];
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }
    if (!tracks[0]) return;
    void this.playback
      .playTrack(tracks[0].id, tracks.map((t) => t.id))
      .then(() => this.playback.command({ type: 'setShuffle', enabled: true }));
  }
}
