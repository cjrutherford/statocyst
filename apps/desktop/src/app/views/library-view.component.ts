import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { Track } from '@statocyst/contracts';
import { ArtworkComponent } from '../components/artwork.component';
import { IconComponent } from '../components/icon.component';
import { LibraryStore } from '../core/library.store';
import { PlaybackStore } from '../core/playback.store';
import {
  formatDuration,
  formatLabel,
  formatLongDuration,
  pluralize,
} from '../core/format';

type SortKey = 'artist' | 'title' | 'album' | 'duration';

@Component({
  selector: 'sc-library-view',
  standalone: true,
  imports: [ArtworkComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="view" aria-labelledby="library-heading">
      <header class="view__head">
        <div>
          <p class="eyebrow">Local collection</p>
          <h1 id="library-heading">Library</h1>
          <p class="lede">
            Your imported audio lives here, entirely on this machine. Nothing leaves the device.
          </p>
        </div>
        <div class="actions">
          <button
            type="button"
            class="btn btn--primary"
            [disabled]="library.importing()"
            (click)="library.pickFiles()"
          >
            <sc-icon name="file-plus" />
            Import files
          </button>
          <button
            type="button"
            class="btn"
            [disabled]="library.importing()"
            (click)="library.pickFolder()"
          >
            <sc-icon name="folder" />
            Import folder
          </button>
          <button
            type="button"
            class="btn btn--quiet"
            [disabled]="library.importing()"
            (click)="library.importDemo()"
          >
            <sc-icon name="sparkles" />
            Load demo
          </button>
        </div>
      </header>

      @if (library.importing()) {
        <div class="import-progress" role="status" aria-live="polite">
          <div class="import-progress__text">
            <sc-icon name="folder" />
            <span>{{ progressLabel() }}</span>
            @if (library.importProgress()?.currentPath; as current) {
              <span class="import-progress__path" [title]="current">{{ current }}</span>
            }
          </div>
          <div class="import-progress__track" aria-hidden="true">
            <div
              class="import-progress__fill"
              [class.is-indeterminate]="progressPercent() === null"
              [style.width.%]="progressPercent() ?? 100"
            ></div>
          </div>
          <button type="button" class="btn btn--quiet" (click)="library.cancelImport()">
            Cancel
          </button>
        </div>
      }

      <div class="stats" role="list" aria-label="Library summary">
        <div class="stat" role="listitem">
          <span class="stat__value">{{ library.stats().tracks }}</span>
          <span class="stat__label">tracks</span>
        </div>
        <div class="stat" role="listitem">
          <span class="stat__value">{{ library.stats().albums }}</span>
          <span class="stat__label">albums</span>
        </div>
        <div class="stat" role="listitem">
          <span class="stat__value">{{ library.stats().artists }}</span>
          <span class="stat__label">artists</span>
        </div>
        <div class="stat" role="listitem">
          <span class="stat__value">{{ formatLongDuration(library.stats().durationMs) }}</span>
          <span class="stat__label">runtime</span>
        </div>
        @if (library.stats().missing > 0) {
          <div class="stat stat--warn" role="listitem">
            <span class="stat__value">{{ library.stats().missing }}</span>
            <span class="stat__label">missing files</span>
          </div>
        }
      </div>

      @if (library.lastImport(); as summary) {
        @if (!summary.cancelled && (summary.imported > 0 || summary.rejected.length > 0)) {
          <div class="import-panel" role="status">
            <div class="import-panel__summary">
              <sc-icon [name]="summary.imported > 0 ? 'check' : 'alert'" />
              <span>
                {{ summary.imported }} imported
                @if (summary.duplicates > 0) {
                  · {{ summary.duplicates }} already catalogued
                }
                @if (summary.rejected.length > 0) {
                  · {{ pluralize(summary.rejected.length, 'file') }} rejected
                }
              </span>
            </div>
            @if (summary.rejected.length > 0) {
              <details class="import-panel__details">
                <summary>Review rejected files</summary>
                <ul>
                  @for (rejection of summary.rejected.slice(0, 25); track rejection.path) {
                    <li>
                      <span class="code">{{ rejection.code }}</span>
                      <span class="path">{{ rejection.path }}</span>
                      <span class="reason">{{ rejection.message }}</span>
                    </li>
                  }
                </ul>
              </details>
            }
          </div>
        }
      }

      @if (library.isEmpty()) {
        <div class="empty">
          <img src="branding/statocyst-symbol.png" alt="" class="empty__mark" />
          <h2>Your library is silent</h2>
          <p>
            Import local audio to start listening. Statocyst reads MP3, FLAC, OGG, Opus, WAV, M4A,
            AAC and WebM files.
          </p>
          <div class="empty__actions">
            <button type="button" class="btn btn--primary" (click)="library.pickFiles()">
              <sc-icon name="file-plus" /> Choose files
            </button>
            <button type="button" class="btn" (click)="library.pickFolder()">
              <sc-icon name="folder" /> Choose a folder
            </button>
            <button type="button" class="btn btn--quiet" (click)="library.importDemo()">
              <sc-icon name="sparkles" /> Load demo library
            </button>
          </div>
        </div>
      } @else {
        <div class="browser">
          <div class="album-strip" role="list" aria-label="Filter by album">
            <button
              type="button"
              class="album-pill"
              [class.is-active]="albumFilter() === null"
              (click)="albumFilter.set(null)"
            >
              All albums
              <span>{{ library.tracks().length }}</span>
            </button>
            @for (album of library.albums(); track album.album + album.artist) {
              <button
                type="button"
                class="album-pill"
                [class.is-active]="albumFilter() === album.album"
                (click)="toggleAlbum(album.album)"
              >
                {{ album.album }}
                <span>{{ album.tracks }}</span>
              </button>
            }
          </div>

          <div class="toolbar">
            <label class="search">
              <sc-icon name="search" />
              <span class="sr-only">Search the library</span>
              <input
                id="library-search"
                type="search"
                placeholder="Search title, artist or album"
                [value]="search()"
                (input)="search.set($any($event.target).value)"
              />
            </label>
            <label class="sort">
              <span>Sort</span>
              <select [value]="sort()" (change)="sort.set($any($event.target).value)">
                <option value="artist">Artist</option>
                <option value="title">Title</option>
                <option value="album">Album</option>
                <option value="duration">Duration</option>
              </select>
            </label>
            <span class="result-count">{{ filtered().length }} of {{ library.tracks().length }}</span>
          </div>

          @if (filtered().length === 0) {
            <div class="no-results">
              <sc-icon name="search" />
              <p>No tracks match “{{ search() || albumFilter() }}”.</p>
              <button type="button" class="btn btn--quiet" (click)="clearFilters()">Clear filters</button>
            </div>
          } @else {
            <div class="table-wrap">
              <table class="track-table">
                <caption class="sr-only">
                  Imported tracks. Use the row actions to play, queue or remove a track.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" class="col-index">#</th>
                    <th scope="col">Title</th>
                    <th scope="col" class="col-album">Album</th>
                    <th scope="col" class="col-format">Format</th>
                    <th scope="col" class="col-duration">Time</th>
                    <th scope="col" class="col-actions"><span class="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (track of filtered(); track track.id; let index = $index) {
                    <tr
                      class="track-row"
                      [class.is-current]="playback.track()?.id === track.id"
                      [class.is-missing]="track.missing"
                      (dblclick)="play(track)"
                    >
                      <td class="col-index">
                        @if (playback.track()?.id === track.id && playback.isPlaying()) {
                          <span class="equalizer" aria-label="Now playing">
                            <i></i><i></i><i></i>
                          </span>
                        } @else {
                          <span class="index">{{ (track.trackNo ?? index + 1) }}</span>
                        }
                      </td>
                      <td>
                        <div class="track-cell">
                          <sc-artwork [track]="track" size="sm" />
                          <div class="track-cell__text">
                            <span class="track-cell__title">{{ track.title }}</span>
                            <span class="track-cell__artist">
                              {{ track.artist }}
                              @if (track.year) {
                                <span class="dot">·</span> {{ track.year }}
                              }
                            </span>
                          </div>
                        </div>
                      </td>
                      <td class="col-album">
                        <span class="album-name">{{ track.album }}</span>
                        <span class="source">{{ track.sourceLabel }}</span>
                      </td>
                      <td class="col-format">
                        <span class="format">{{ formatLabel(track.format) }}</span>
                      </td>
                      <td class="col-duration">{{ formatDuration(track.durationMs) }}</td>
                      <td class="col-actions">
                        <div class="row-actions">
                          <button
                            type="button"
                            class="icon-btn icon-btn--play"
                            [attr.aria-label]="'Play ' + track.title"
                            (click)="play(track)"
                          >
                            <sc-icon name="play" />
                          </button>
                          <button
                            type="button"
                            class="icon-btn"
                            [attr.aria-label]="'Play ' + track.title + ' next'"
                            title="Play next"
                            (click)="playNext(track)"
                          >
                            <sc-icon name="up" />
                          </button>
                          <button
                            type="button"
                            class="icon-btn"
                            [attr.aria-label]="'Add ' + track.title + ' to queue'"
                            title="Add to queue"
                            (click)="enqueue(track)"
                          >
                            <sc-icon name="plus" />
                          </button>
                          <button
                            type="button"
                            class="icon-btn icon-btn--danger"
                            [attr.aria-label]="'Remove ' + track.title + ' from library'"
                            title="Remove from library"
                            (click)="remove(track)"
                          >
                            <sc-icon name="trash" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      .view {
        display: grid;
        gap: clamp(16px, 2vw, 26px);
        padding: clamp(20px, 3vw, 38px);
        max-width: 1480px;
        margin: 0 auto;
        animation: rise 380ms ease both;
      }
      .view__head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 20px;
        flex-wrap: wrap;
      }
      h1 {
        font-size: clamp(2rem, 3.4vw, 3rem);
        letter-spacing: -0.03em;
        margin: 4px 0 6px;
      }
      .lede {
        color: var(--muted);
        max-width: 58ch;
        margin: 0;
        font-size: 0.92rem;
      }
      .actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .import-progress {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 12px 16px;
        border-radius: 14px;
        border: 1px solid rgba(56, 225, 255, 0.22);
        background: rgba(56, 225, 255, 0.05);
        font-size: 0.84rem;
      }
      .import-progress__text {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--text);
        min-width: 0;
        flex: 1;
      }
      .import-progress__path {
        color: var(--muted);
        font-size: 0.74rem;
        font-family: var(--mono);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .import-progress__track {
        flex: 1;
        min-width: 120px;
        height: 6px;
        border-radius: 999px;
        background: var(--surface-1);
        overflow: hidden;
      }
      .import-progress__fill {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--cyan), #7fd4ff);
        transition: width 180ms ease;
      }
      .import-progress__fill.is-indeterminate {
        width: 40% !important;
        animation: import-slide 1.1s ease-in-out infinite;
      }
      @keyframes import-slide {
        0% {
          transform: translateX(-120%);
        }
        100% {
          transform: translateX(360%);
        }
      }
      .stats {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .stat {
        display: grid;
        gap: 1px;
        padding: 10px 18px 10px 14px;
        min-width: 96px;
        border-radius: 14px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-left: 2px solid rgba(56, 225, 255, 0.45);
      }
      .stat--warn {
        border-left-color: var(--danger);
      }
      .stat__value {
        font-size: 1.18rem;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .stat__label {
        font-size: 0.68rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .import-panel {
        border: 1px solid rgba(56, 225, 255, 0.22);
        background: rgba(56, 225, 255, 0.05);
        border-radius: var(--radius);
        padding: 12px 16px;
        font-size: 0.86rem;
      }
      .import-panel__summary {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--text);
      }
      .import-panel__details {
        margin-top: 8px;
        color: var(--muted);
      }
      .import-panel__details summary {
        cursor: pointer;
        font-size: 0.78rem;
        letter-spacing: 0.04em;
      }
      .import-panel__details ul {
        margin: 10px 0 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 6px;
        max-height: 180px;
        overflow: auto;
      }
      .import-panel__details li {
        display: grid;
        grid-template-columns: 130px minmax(160px, 1fr) minmax(140px, 1fr);
        gap: 10px;
        font-size: 0.74rem;
        align-items: baseline;
      }
      .code {
        font-family: var(--mono);
        color: var(--danger);
        font-size: 0.68rem;
        letter-spacing: 0.04em;
      }
      .path {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--muted);
      }
      .reason {
        color: var(--muted);
      }
      .empty {
        display: grid;
        justify-items: center;
        text-align: center;
        gap: 12px;
        padding: clamp(30px, 6vw, 70px) 20px;
        border-radius: 28px;
        border: 1px dashed rgba(148, 197, 255, 0.18);
        background:
          radial-gradient(circle at 50% 0%, rgba(56, 225, 255, 0.07), transparent 62%),
          var(--surface-3);
      }
      .empty__mark {
        width: 96px;
        height: 96px;
        object-fit: contain;
        opacity: 0.85;
        filter: drop-shadow(0 0 22px rgba(56, 225, 255, 0.3));
      }
      .empty h2 {
        margin: 0;
        font-size: 1.5rem;
      }
      .empty p {
        margin: 0;
        color: var(--muted);
        max-width: 52ch;
      }
      .empty__actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: center;
        margin-top: 6px;
      }
      .browser {
        display: grid;
        gap: 14px;
      }
      .album-strip {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding-bottom: 4px;
        scrollbar-width: thin;
      }
      .album-pill {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 14px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: var(--surface-2);
        color: var(--muted);
        font-size: 0.78rem;
        cursor: pointer;
        transition: border-color 140ms ease, color 140ms ease, background 140ms ease;
      }
      .album-pill span {
        font-size: 0.66rem;
        color: var(--muted);
        background: rgba(148, 197, 255, 0.1);
        padding: 1px 6px;
        border-radius: 999px;
      }
      .album-pill:hover {
        color: var(--text);
        border-color: rgba(56, 225, 255, 0.4);
      }
      .album-pill.is-active {
        color: #04131f;
        background: linear-gradient(120deg, var(--cyan), #7fd4ff);
        border-color: transparent;
        font-weight: 600;
      }
      .album-pill.is-active span {
        color: #04131f;
        background: rgba(4, 19, 31, 0.16);
      }
      .toolbar {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .search {
        flex: 1;
        min-width: 220px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 14px;
        border-radius: 12px;
        background: var(--surface-1);
        border: 1px solid var(--line);
        color: var(--muted);
      }
      .search input {
        flex: 1;
        background: none;
        border: 0;
        outline: none;
        color: var(--text);
        font: inherit;
        font-size: 0.86rem;
      }
      .sort {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.74rem;
        color: var(--muted);
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .sort select {
        background: var(--surface-1);
        color: var(--text);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 7px 10px;
        font: inherit;
        font-size: 0.8rem;
        text-transform: none;
        letter-spacing: normal;
      }
      .result-count {
        font-size: 0.74rem;
        color: var(--muted);
        font-variant-numeric: tabular-nums;
      }
      .table-wrap {
        border-radius: var(--radius);
        border: 1px solid var(--line);
        background: var(--surface-3);
        overflow: hidden;
      }
      .track-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.86rem;
      }
      .track-table th {
        text-align: left;
        font-weight: 600;
        font-size: 0.66rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
        padding: 12px 12px;
        border-bottom: 1px solid var(--line);
        background: var(--surface-1);
        position: sticky;
        top: 0;
        z-index: 1;
      }
      .track-row {
        transition: background 120ms ease;
      }
      .track-row:hover {
        background: var(--surface-row-hover);
      }
      .track-row.is-current {
        background: rgba(56, 225, 255, 0.12);
      }
      .track-row.is-missing .track-cell__title {
        color: var(--muted);
        text-decoration: line-through;
        text-decoration-color: rgba(255, 107, 138, 0.5);
      }
      .track-row td {
        padding: 8px 12px;
        border-bottom: 1px solid rgba(148, 197, 255, 0.07);
        vertical-align: middle;
      }
      .track-row:last-child td {
        border-bottom: 0;
      }
      .col-index {
        width: 44px;
        color: var(--muted);
        font-variant-numeric: tabular-nums;
        text-align: center;
      }
      .col-duration {
        width: 72px;
        font-variant-numeric: tabular-nums;
        color: var(--muted);
      }
      .col-format {
        width: 70px;
      }
      .col-actions {
        width: 168px;
      }
      .track-cell {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }
      .track-cell__text {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .track-cell__title {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .track-cell__artist {
        color: var(--muted);
        font-size: 0.76rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dot {
        opacity: 0.5;
        margin: 0 2px;
      }
      .album-name {
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 230px;
      }
      .source {
        display: block;
        color: var(--muted);
        font-size: 0.68rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .format {
        font-size: 0.64rem;
        letter-spacing: 0.1em;
        color: var(--cyan);
        border: 1px solid rgba(56, 225, 255, 0.28);
        border-radius: 6px;
        padding: 2px 6px;
      }
      .row-actions {
        display: flex;
        justify-content: flex-end;
        gap: 2px;
        opacity: 0;
        transition: opacity 120ms ease;
      }
      .track-row:hover .row-actions,
      .track-row:focus-within .row-actions,
      .track-row.is-current .row-actions {
        opacity: 1;
      }
      .icon-btn--play {
        color: var(--cyan);
      }
      .icon-btn--danger:hover {
        color: var(--danger);
        background: rgba(255, 107, 138, 0.12);
      }
      .no-results {
        display: grid;
        justify-items: center;
        gap: 10px;
        padding: 42px;
        color: var(--muted);
        border: 1px dashed var(--line);
        border-radius: var(--radius);
        font-size: 0.9rem;
      }
      .equalizer {
        display: inline-flex;
        align-items: flex-end;
        gap: 2px;
        height: 14px;
      }
      .equalizer i {
        width: 3px;
        background: var(--cyan);
        border-radius: 2px;
        animation: eq 900ms ease-in-out infinite;
      }
      .equalizer i:nth-child(2) {
        animation-delay: 180ms;
      }
      .equalizer i:nth-child(3) {
        animation-delay: 340ms;
      }
      @keyframes eq {
        0%,
        100% {
          height: 4px;
        }
        50% {
          height: 13px;
        }
      }
      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @media (max-width: 1100px) {
        .col-album,
        .col-format {
          display: none;
        }
        .col-actions {
          width: 140px;
        }
        .row-actions {
          opacity: 1;
        }
      }
      @media (max-width: 760px) {
        .view {
          padding: 18px 14px;
        }
        .track-table th,
        .track-row td {
          padding-left: 8px;
          padding-right: 8px;
        }
        .col-index,
        .col-duration {
          display: none;
        }
        .import-panel__details li {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class LibraryViewComponent {
  protected readonly library = inject(LibraryStore);
  protected readonly playback = inject(PlaybackStore);
  protected readonly formatDuration = formatDuration;
  protected readonly formatLongDuration = formatLongDuration;
  protected readonly formatLabel = formatLabel;
  protected readonly pluralize = pluralize;

  protected readonly search = signal('');
  protected readonly albumFilter = signal<string | null>(null);
  protected readonly sort = signal<SortKey>('artist');

  protected readonly progressLabel = computed(() => {
    const progress = this.library.importProgress();
    if (!progress) return 'Preparing…';
    if (progress.phase === 'scanning') {
      return progress.total ? `Reading ${progress.scanned} of ${progress.total} files` : `Reading ${progress.scanned} files`;
    }
    return `Importing ${progress.imported} of ${progress.total ?? progress.imported}`;
  });

  protected readonly progressPercent = computed(() => {
    const progress = this.library.importProgress();
    if (!progress || !progress.total) return null;
    const done = progress.phase === 'scanning' ? progress.scanned : progress.imported;
    return Math.min(100, Math.round((done / progress.total) * 100));
  });

  protected readonly filtered = computed(() => {
    const term = this.search().trim().toLowerCase();
    const album = this.albumFilter();
    const rows = this.library.tracks().filter((track) => {
      if (album && track.album !== album) return false;
      if (!term) return true;
      return [track.title, track.artist, track.album, track.albumArtist ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
    const sorted = [...rows];
    switch (this.sort()) {
      case 'title':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'album':
        sorted.sort(
          (a, b) =>
            a.album.localeCompare(b.album) ||
            (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
            a.title.localeCompare(b.title),
        );
        break;
      case 'duration':
        sorted.sort((a, b) => b.durationMs - a.durationMs);
        break;
      default:
        sorted.sort(
          (a, b) =>
            a.artist.localeCompare(b.artist) ||
            a.album.localeCompare(b.album) ||
            (a.trackNo ?? 0) - (b.trackNo ?? 0),
        );
    }
    return sorted;
  });

  protected toggleAlbum(album: string): void {
    this.albumFilter.set(this.albumFilter() === album ? null : album);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.albumFilter.set(null);
  }

  protected play(track: Track): void {
    void this.playback.playTrack(track.id);
  }

  protected playNext(track: Track): void {
    void this.playback.playNext(track.id);
  }

  protected enqueue(track: Track): void {
    void this.playback.enqueue([track.id]);
  }

  protected remove(track: Track): void {
    const confirmed = window.confirm(
      `Remove “${track.title}” from the library? The audio file itself is not deleted.`,
    );
    if (confirmed) void this.library.removeTrack(track);
  }
}
