import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { PodcastEpisode, Track } from '@statocyst/contracts';
import { ArtworkComponent } from '../components/artwork.component';
import { IconComponent } from '../components/icon.component';
import { LibraryStore } from '../core/library.store';
import { DownloadsStore } from '../core/downloads.store';
import { PlaybackStore } from '../core/playback.store';
import { PodcastPlaybackStore } from '../core/podcast-playback.store';
import { PodcastsStore } from '../core/podcasts.store';
import { NavigationStore } from '../core/navigation.store';
import { bridge, isNativePlatform } from '../core/bridge';
import { formatDuration, formatBytes } from '../core/format';

@Component({
  selector: 'sc-offline-view',
  standalone: true,
  imports: [ArtworkComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="view" aria-labelledby="offline-heading">
      <header class="view__head">
        <div>
          <p class="eyebrow">On this device</p>
          <h1 id="offline-heading">Offline</h1>
          <p class="lede">
            Tracks that play with no network: pinned downloads and audio imported onto this device.
          </p>
        </div>
      </header>

      @if (tracks().length === 0 && podcastDownloads().length === 0) {
        <div class="empty">
          <sc-icon name="offline" />
          <h2>Nothing saved for offline yet</h2>
          <p>
            Download tracks from the Library, or import audio from this device, and they will
            appear here.
          </p>
          <button type="button" class="btn" (click)="navigation.navigate('library')">
            <sc-icon name="library" /> Browse library
          </button>
        </div>
      } @else {
        @if (podcastDownloads().length > 0) {
          <div class="podcast-offline">
            <div class="section-head">
              <h2>Podcast episodes</h2>
              <span class="result-count">{{ podcastDownloads().length }} pinned</span>
            </div>
            <ul>
              @for (episode of podcastDownloads(); track episode.id) {
                <li>
                  <button type="button" class="podcast-row" (click)="playPodcast(episode)">
                    <sc-artwork [src]="episode.artworkUrl" [track]="episode" size="sm" />
                    <span class="podcast-row__text">
                      <span class="podcast-row__show">{{ episode.feedTitle }}</span>
                      <span class="podcast-row__title">{{ episode.title }}</span>
                    </span>
                    <span class="podcast-row__time">{{ formatDuration(episode.durationMs) }}</span>
                  </button>
                  <button
                    type="button"
                    class="icon-btn icon-btn--danger"
                    aria-label="Remove download"
                    (click)="removePodcastDownload(episode)"
                  >
                    <sc-icon name="trash" />
                  </button>
                </li>
              }
            </ul>
          </div>
        }
        <div class="toolbar">
          <span class="result-count">{{ tracks().length }} offline track{{ tracks().length === 1 ? '' : 's' }}@if (offlineBytes() > 0) { · {{ formatBytes(offlineBytes()) }} }</span>
          @if (downloads.stats().count > 0) {
            <span class="result-count">{{ downloads.stats().count }} pinned · {{ formatBytes(downloads.stats().totalBytes) }}</span>
          }
        </div>
        <div class="table-wrap">
          <table class="track-table">
            <caption class="sr-only">Offline tracks available without a network.</caption>
            <thead>
              <tr>
                <th scope="col" class="col-index">#</th>
                <th scope="col">Title</th>
                <th scope="col" class="col-album">Album</th>
                <th scope="col" class="col-format">Source</th>
                <th scope="col" class="col-size">Size</th>
                <th scope="col" class="col-duration">Time</th>
                <th scope="col" class="col-actions"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (track of tracks(); track track.id; let index = $index) {
                <tr [class.is-playing]="playback.track()?.id === track.id">
                  <td class="col-index">{{ index + 1 }}</td>
                  <td class="col-title">
                    <button type="button" class="title-btn" (click)="play(track)">
                      <sc-artwork [src]="track.artworkUrl" [altText]="track.title" size="sm" />
                      <span class="title-text">
                        <span class="title">{{ track.title }}</span>
                        <span class="artist">{{ track.artist }}</span>
                      </span>
                    </button>
                  </td>
                  <td class="col-album">{{ track.album }}</td>
                  <td class="col-format">
                    @if (track.sourceId === 'local') {
                      <span class="badge">Imported</span>
                    } @else if (downloads.isDownloaded()(track.id)) {
                      <span class="badge badge--ok">
                        Pinned@if (downloads.profileOf()(track.id); as profile) { · {{ profile }} }
                      </span>
                    }
                  </td>
                  <td class="col-size">{{ formatBytes(track.sizeBytes ?? 0) }}</td>
                  <td class="col-duration">{{ formatDuration(track.durationMs) }}</td>
                  <td class="col-actions">
                    <button type="button" class="icon-btn" aria-label="Play" (click)="play(track)">
                      <sc-icon name="play" />
                    </button>
                    <button type="button" class="icon-btn" aria-label="Add to queue" (click)="enqueue(track)">
                      <sc-icon name="plus" />
                    </button>
                    @if (track.sourceId === 'local') {
                      <button type="button" class="icon-btn icon-btn--danger" aria-label="Remove from device" (click)="remove(track)">
                        <sc-icon name="trash" />
                      </button>
                    } @else if (downloads.supported && downloads.isDownloaded()(track.id)) {
                      <button type="button" class="icon-btn icon-btn--danger" aria-label="Remove download" (click)="removeDownload(track)">
                        <sc-icon name="trash" />
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .view { display: grid; gap: clamp(16px, 2vw, 26px); padding: clamp(20px, 3vw, 38px); max-width: 1480px; margin: 0 auto; animation: rise 380ms ease both; }
      .view__head { display: flex; flex-direction: column; gap: 4px; }
      h1 { font-size: clamp(2rem, 3.4vw, 3rem); letter-spacing: -0.03em; margin: 4px 0 6px; }
      .lede { color: var(--muted); max-width: 58ch; margin: 0; font-size: 0.92rem; }
      .empty { display: grid; place-items: center; gap: 12px; padding: 60px 20px; color: var(--muted); text-align: center; }
      .empty sc-icon { width: 48px; height: 48px; opacity: 0.5; }
      .toolbar { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
      .result-count { color: var(--muted); font-size: 0.82rem; }
      .table-wrap { overflow: auto; border-radius: 14px; border: 1px solid var(--line); }
      .track-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
      .track-table th, .track-table td { padding: 10px 12px; text-align: left; }
      .track-table thead th { color: var(--muted); font-weight: 600; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid var(--line); }
      .track-table tbody tr { border-bottom: 1px solid rgba(255,255,255,0.04); }
      .track-table tbody tr.is-playing { background: rgba(56,225,255,0.06); }
      .title-btn { display: flex; align-items: center; gap: 10px; background: none; border: none; color: inherit; cursor: pointer; padding: 0; text-align: left; }
      .title-text { display: flex; flex-direction: column; }
      .title { font-weight: 600; }
      .artist { color: var(--muted); font-size: 0.78rem; }
      .badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.08); color: var(--muted); }
      .badge--ok { background: rgba(56,225,255,0.12); color: var(--cyan); }
      .icon-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; display: inline-grid; place-items: center; }
      .icon-btn--danger:hover { color: var(--danger); background: rgba(255,107,138,0.12); }
      .col-index { width: 36px; color: var(--muted); }
      .col-album { color: var(--muted); }
      .col-format { color: var(--muted); font-size: 0.78rem; }
      .col-size { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.78rem; }
      .col-duration { color: var(--muted); font-variant-numeric: tabular-nums; }
      .col-actions { text-align: right; white-space: nowrap; }
      .podcast-offline { display: grid; gap: 8px; }
      .section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .podcast-offline h2 { margin: 0; font-size: 1rem; }
      .podcast-offline ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
      .podcast-offline li { display: flex; align-items: center; gap: 4px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-1); padding: 4px; }
      .podcast-row { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; padding: 4px; cursor: pointer; }
      .podcast-row:hover { background: var(--surface-row-hover); border-radius: var(--radius-sm); }
      .podcast-row__text { display: grid; gap: 1px; min-width: 0; flex: 1; }
      .podcast-row__show { color: var(--cyan); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em; }
      .podcast-row__title { font-weight: 600; font-size: 0.82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .podcast-row__time { color: var(--muted); font-size: 0.72rem; }
      @media (max-width: 720px) {
        .col-index, .col-album, .col-format, .col-size, .col-duration { display: none; }
        .track-table th, .track-table td { padding: 10px 8px; }
        .title-btn { min-width: 0; }
      }
    `,
  ],
})
export class OfflineViewComponent {
  protected readonly formatDuration = formatDuration;
  protected readonly library = inject(LibraryStore);
  protected readonly downloads = inject(DownloadsStore);
  protected readonly playback = inject(PlaybackStore);
  protected readonly podcasts = inject(PodcastsStore);
  protected readonly podcastPlayback = inject(PodcastPlaybackStore);
  protected readonly navigation = inject(NavigationStore);
  protected readonly podcastDownloads = signal<PodcastEpisode[]>([]);

  constructor() {
    void this.loadPodcastDownloads();
  }

  protected readonly tracks = computed<Track[]>(() => {
    const isDownloaded = this.downloads.isDownloaded();
    return this.library.tracks().filter(
      (track) => track.sourceId === 'local' || isDownloaded(track.id),
    );
  });

  protected readonly offlineBytes = computed(() =>
    this.tracks().reduce((sum, track) => sum + (track.sizeBytes ?? 0), 0),
  );

  protected play(track: Track): void {
    void this.playback.playTrack(track.id);
  }

  protected playPodcast(episode: PodcastEpisode): void {
    void this.podcastPlayback.playEpisode(episode, this.podcastDownloads());
  }

  protected removePodcastDownload(episode: PodcastEpisode): void {
    void this.downloads.remove(episode.id, episode.title).then(() => this.loadPodcastDownloads());
  }

  private async loadPodcastDownloads(): Promise<void> {
    const api = bridge().podcast;
    if (!api) return;
    await this.podcasts.init();
    await this.downloads.init();
    const isDownloaded = this.downloads.isDownloaded();
    const lists = await Promise.all(
      this.podcasts
        .feeds()
        .map((feed) => api.listEpisodes(feed.id, { limit: 200 }).catch(() => [])),
    );
    this.podcastDownloads.set(lists.flat().filter((episode) => isDownloaded(episode.id)));
  }

  protected enqueue(track: Track): void {
    void this.playback.enqueue([track.id]);
  }

  protected remove(track: Track): void {
    if (track.sourceId === 'local') {
      void this.library.removeTrack(track);
    }
  }

  protected removeDownload(track: Track): void {
    void this.downloads.remove(track.id, track.title);
  }

  protected formatBytes = formatBytes;
}
