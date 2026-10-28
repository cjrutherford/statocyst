import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { Track } from '@statocyst/contracts';
import { ArtworkComponent } from '../components/artwork.component';
import { IconComponent } from '../components/icon.component';
import { LibraryStore } from '../core/library.store';
import { FavoritesStore } from '../core/favorites.store';
import { PlaylistsStore } from '../core/playlists.store';
import { DownloadsStore } from '../core/downloads.store';
import { PlaybackStore } from '../core/playback.store';
import { formatDuration } from '../core/format';

@Component({
  selector: 'sc-playlists-view',
  standalone: true,
  imports: [ArtworkComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="view" aria-labelledby="playlists-heading">
      <header class="view__head">
        <div>
          <p class="eyebrow">Auto playlists</p>
          <h1 id="playlists-heading">Playlists</h1>
          <p class="lede">
            Smart lists built from your library. Favorites are stored on this device; nothing is uploaded.
          </p>
        </div>
        <div class="actions">
          <button type="button" class="btn btn--quiet" (click)="saveFavorites()">Save favorites as playlist</button>
          <button type="button" class="btn btn--quiet" (click)="saveRecentlyAdded()">Save recently added</button>
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
          <button type="button" class="smart-card__play" (click)="playList(recentlyAdded())" [disabled]="recentlyAdded().length === 0">
            <sc-icon name="sparkles" />
            <span class="smart-card__name">Recently added</span>
            <span class="smart-card__count">{{ recentlyAdded().length }} track{{ recentlyAdded().length === 1 ? '' : 's' }}</span>
          </button>
          @if (downloads.supported && recentlyAdded().length > 0) {
            <button type="button" class="smart-card__download" aria-label="Download recently added" (click)="downloadIds(recentlyAdded().map(t => t.id))">
              <sc-icon name="download" />
            </button>
          }
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
        <h2>Recently added</h2>
        @if (recentlyAdded().length === 0) {
          <p class="empty-hint">Import or sync tracks to see them here.</p>
        } @else {
          <ul class="mini-list">
            @for (track of recentlyAdded(); track track.id) {
              <li>
                <button type="button" class="mini-row" (click)="play(track)">
                  <sc-artwork [src]="track.artworkUrl" [altText]="track.title" size="sm" />
                  <span class="mini-text">
                    <span class="mini-title">{{ track.title }}</span>
                    <span class="mini-artist">{{ track.artist }}</span>
                  </span>
                  <span class="mini-duration">{{ formatDuration(track.durationMs) }}</span>
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  [class.is-active]="favoritesStore.isFavorite()(track.id)"
                  [attr.aria-pressed]="favoritesStore.isFavorite()(track.id)"
                  aria-label="Toggle favorite"
                  (click)="favoritesStore.toggle(track.id)"
                >
                  <sc-icon name="offline" />
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

      <p class="note">
        Listening-history lists (recently played, most played) appear once listening history is
        enabled in Settings and enough plays are recorded. Manual playlists are a deferred feature.
      </p>
    </section>
  `,
  styles: [
    `
      .view { display: grid; gap: clamp(16px, 2vw, 26px); padding: clamp(20px, 3vw, 38px); max-width: 1480px; margin: 0 auto; animation: rise 380ms ease both; }
      .view__head { display: flex; flex-direction: column; gap: 4px; }
      h1 { font-size: clamp(2rem, 3.4vw, 3rem); letter-spacing: -0.03em; margin: 4px 0 6px; }
      .lede { color: var(--muted); max-width: 58ch; margin: 0; font-size: 0.92rem; }
      .smart-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
      .smart-card { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 16px; border-radius: 14px; border: 1px solid var(--line); background: rgba(255,255,255,0.03); }
      .smart-card__play { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; border: none; background: transparent; color: var(--text); cursor: pointer; text-align: left; padding: 0; width: 100%; }
      .smart-card__play:disabled { opacity: 0.5; cursor: not-allowed; }
      .smart-card--play { cursor: pointer; }
      .smart-card sc-icon { width: 22px; height: 22px; color: var(--cyan); }
      .smart-card__name { font-weight: 600; }
      .smart-card__count { color: var(--muted); font-size: 0.78rem; }
      .smart-card__download { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; display: inline-grid; place-items: center; }
      .smart-card__download:hover { color: var(--cyan); border-color: var(--cyan); }
      .list-block { display: grid; gap: 10px; }
      .list-block h2 { font-size: 1.1rem; margin: 0; }
      .empty-hint { color: var(--muted); font-size: 0.86rem; margin: 0; }
      .mini-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
      .mini-list li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 12px; border: 1px solid var(--line); background: rgba(255,255,255,0.02); }
      .mini-row { display: flex; align-items: center; gap: 10px; flex: 1; background: none; border: none; color: inherit; cursor: pointer; padding: 0; text-align: left; }
      .mini-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .mini-title { font-weight: 600; font-size: 0.88rem; }
      .mini-artist { color: var(--muted); font-size: 0.76rem; }
      .mini-duration { color: var(--muted); font-size: 0.76rem; font-variant-numeric: tabular-nums; }
      .icon-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; display: inline-grid; place-items: center; }
      .icon-btn.is-active { color: var(--cyan); border-color: var(--cyan); }
      .note { color: var(--muted); font-size: 0.78rem; max-width: 70ch; }
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

  protected readonly favorites = this.favoritesStore.tracks;
  protected readonly recentlyAdded = computed<Track[]>(() =>
    [...this.library.tracks()].slice(-25).reverse(),
  );

  protected play(track: Track): void {
    void this.playback.playTrack(track.id);
  }

  protected saveFavorites(): void {
    const ids = this.favoritesStore.tracks().map((t) => t.id);
    if (ids.length === 0) return;
    const name = window.prompt('Name this playlist', 'Favorites');
    if (!name) return;
    this.playlistsStore.create(name, ids);
  }

  protected saveRecentlyAdded(): void {
    const ids = this.recentlyAdded().map((t) => t.id);
    if (ids.length === 0) return;
    const name = window.prompt('Name this playlist', 'Recently added');
    if (!name) return;
    this.playlistsStore.create(name, ids);
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
