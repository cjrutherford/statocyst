import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { Track } from '@statocyst/contracts';
import { ArtworkComponent } from '../components/artwork.component';
import { IconComponent } from '../components/icon.component';
import { JellyfinPanelComponent } from '../components/jellyfin-panel.component';
import { LibraryStore } from '../core/library.store';
import { DownloadsStore } from '../core/downloads.store';
import { FavoritesStore } from '../core/favorites.store';
import { PlaylistsStore } from '../core/playlists.store';
import { PlaybackStore } from '../core/playback.store';
import { RadioStore } from '../core/radio.store';
import { ToastStore } from '../core/toast.store';
import { isNativePlatform } from '../core/bridge';
import {
  formatDuration,
  formatLabel,
  pluralize,
} from '../core/format';

type SortKey = 'artist' | 'title' | 'album' | 'duration';

@Component({
  selector: 'sc-library-view',
  standalone: true,
  imports: [ArtworkComponent, IconComponent, JellyfinPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="view" aria-labelledby="library-heading">
      <header class="view__head">
        <div>
          <p class="eyebrow">Local collection</p>
          <h1 id="library-heading">Library</h1>
          <p class="lede">
            Your imported audio and Jellyfin catalog live on this device. Nothing is uploaded.
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
          @if (!isNative()) {
            <button
              type="button"
              class="btn btn--quiet"
              [disabled]="library.importing()"
              (click)="library.importDemo()"
            >
              <sc-icon name="sparkles" />
              Load demo
            </button>
          }
          <button
            type="button"
            class="btn"
            [disabled]="filtered().length === 0"
            (click)="shuffleAll()"
          >
            <sc-icon name="shuffle" />
            Shuffle all
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
            Stream from a Jellyfin server to start listening, or import audio from this device.
          </p>
          <div class="empty__setup">
            <p class="empty__setup-hint">Have a Jellyfin server?</p>
            <button type="button" class="btn btn--primary" (click)="showJellyfinSetup.set(true)">
              <sc-icon name="external" /> Connect to Jellyfin
            </button>
            <p class="empty__setup-hint" style="margin-top: 8px; font-size: 0.85em; opacity: 0.7;">
              Supports password login and Quick Connect (SSO-friendly)
            </p>
          </div>
          <div class="empty__actions">
            <button type="button" class="btn" (click)="library.pickFiles()">
              <sc-icon name="file-plus" /> Choose files
            </button>
            <button type="button" class="btn" (click)="library.pickFolder()">
              <sc-icon name="folder" /> Choose a folder
            </button>
            @if (!isNative()) {
              <button type="button" class="btn btn--quiet" (click)="library.importDemo()">
                <sc-icon name="sparkles" /> Load demo library
              </button>
            }
          </div>
          @if (showJellyfinSetup()) {
            <div class="empty__jellyfin">
              <sc-jellyfin-panel />
            </div>
          }
        </div>
      } @else {
        <div class="browser">
          <div class="mode-tabs" role="tablist" aria-label="Browse library">
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="mode() === 'tracks'"
              [class.is-active]="mode() === 'tracks'"
              (click)="setMode('tracks')"
            >
              Tracks
              <span>{{ library.tracks().length }}</span>
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="mode() === 'albums'"
              [class.is-active]="mode() === 'albums'"
              (click)="setMode('albums')"
            >
              Albums
              <span>{{ library.albums().length }}</span>
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="mode() === 'artists'"
              [class.is-active]="mode() === 'artists'"
              (click)="setMode('artists')"
            >
              Artists
              <span>{{ artists().length }}</span>
            </button>
          </div>

          @if (mode() === 'tracks') {
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
            @if (downloads.supported) {
              <button
                type="button"
                class="chip-toggle"
                [class.is-active]="offlineOnly()"
                [attr.aria-pressed]="offlineOnly()"
                (click)="offlineOnly.set(!offlineOnly())"
              >
                <sc-icon name="download" /> Offline
              </button>
            }
            @if (selectMode()) {
              <span class="select-hint">Tap tracks to select · long-press to start</span>
            }
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

            @if (selectMode()) {
              <div class="selection-bar" role="toolbar" aria-label="Selection actions">
                <label class="select-all">
                  <input
                    type="checkbox"
                    [checked]="allVisibleSelected()"
                    (change)="toggleSelectAll()"
                  />
                  <span>Select all ({{ selectedCount() }} of {{ filtered().length }})</span>
                </label>
                <button type="button" class="btn btn--quiet" [disabled]="selectedCount() === 0" (click)="downloadSelected()">
                  <sc-icon name="download" /> Download
                </button>
                <button type="button" class="btn btn--quiet" [disabled]="selectedCount() === 0" (click)="favoriteSelected()">
                  <sc-icon name="sparkles" /> Favorite
                </button>
                <button type="button" class="btn btn--quiet" [disabled]="selectedCount() === 0" (click)="saveSelectionAsPlaylist()">
                  <sc-icon name="plus" /> Save as playlist
                </button>
                <button type="button" class="btn btn--quiet" (click)="clearSelectionAndExit()">
                  <sc-icon name="close" /> Cancel
                </button>
              </div>
            }

            @if (downloads.isBatchRunning() && !downloads.queue()) {
              <div class="dl-progress" role="status" aria-live="polite">
                <span>Downloading… {{ downloads.batchPercent() ?? 0 }}%</span>
                <div class="dl-progress__bar">
                  <span [style.width.%]="downloads.batchPercent() ?? 8"></span>
                </div>
                <span>{{ downloads.batch()?.done }} / {{ downloads.batch()?.total }}</span>
              </div>
            }

            @if (filtered().length === 0) {
              <div class="no-results">
                <sc-icon name="search" />
                <p>No tracks match.</p>
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
                    @if (selectMode()) {
                      <th scope="col" class="col-select"><span class="sr-only">Select</span></th>
                    }
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
                      [class.is-selected]="selected().has(track.id)"
                      (click)="onRowClick(track, $event)"
                      (dblclick)="play(track)"
                      (pointerdown)="onRowPointerDown(track, $event)"
                      (pointerup)="onRowPointerUp()"
                      (pointermove)="onRowPointerMove($event)"
                      (pointerleave)="onRowPointerUp()"
                      (contextmenu)="openContextMenu(track, $event)"
                    >
                      @if (selectMode()) {
                        <td class="col-select">
                          <input
                            type="checkbox"
                            [checked]="selected().has(track.id)"
                            (change)="toggleSelect(track.id)"
                            [attr.aria-label]="'Select ' + track.title"
                          />
                        </td>
                      }
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
                            <span class="track-cell__title">
                              {{ track.title }}
                              @if (downloads.isDownloaded()(track.id)) {
                                <span class="dl-badge" title="Available offline">
                                  <sc-icon name="download" />
                                </span>
                              }
                            </span>
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
                            [attr.aria-label]="'More actions for ' + track.title"
                            title="More"
                            (click)="openContextMenu(track, $event); $event.stopPropagation()"
                          >
                            <sc-icon name="down" />
                          </button>
                          @if (downloads.supported && track.sourceId !== 'local' && downloads.isDownloading()(track.id)) {
                            <span class="dl-ring" [style.--progress]="downloadPercent(track.id)"></span>
                          }
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          } @else if (detail(); as d) {
            <div class="detail">
              <button type="button" class="btn btn--quiet detail__back" (click)="closeDetail()">← {{ backLabel() }}</button>
              @if (d.kind === 'artist') {
                <header class="detail__head">
                  <span class="detail__avatar">
                    @if (detailArtwork()) {
                      <sc-artwork [src]="detailArtwork()" [altText]="d.artist" size="hero" />
                    } @else {
                      <span class="artist-card__initial">{{ d.artist.charAt(0).toUpperCase() }}</span>
                    }
                  </span>
                  <div class="detail__text">
                    <span class="eyebrow">Artist</span>
                    <h2>{{ d.artist }}</h2>
                    <p class="detail__meta">{{ detailMeta() }}</p>
                  </div>
                  <div class="detail__actions">
                    <button type="button" class="btn" (click)="playDetail(false)"><sc-icon name="play" /> Play</button>
                    <button type="button" class="btn" (click)="playDetail(true)"><sc-icon name="shuffle" /> Shuffle</button>
                    @if (downloads.supported) {
                      <button type="button" class="btn btn--quiet" [disabled]="downloads.isBatchRunning()" (click)="downloadDetail()">
                        <sc-icon name="download" /> Download all
                      </button>
                    }
                  </div>
                </header>
                <div class="album-grid">
                  @for (album of detailAlbums(); track album.album; let index = $index) {
                    <button type="button" class="album-card" [style.--i]="index" (click)="openAlbum(album.album, album.artist, true)">
                      <span class="album-card__art">
                        <sc-artwork [src]="album.artwork" [altText]="album.album" size="hero" />
                      </span>
                      <span class="album-card__name">{{ album.album }}</span>
                      <span class="album-card__count">{{ album.tracks }} track{{ album.tracks === 1 ? '' : 's' }}</span>
                    </button>
                  }
                </div>
              } @else {
                <header class="detail__head">
                  <span class="detail__cover">
                    <sc-artwork [src]="detailArtwork()" [altText]="d.album" size="hero" />
                  </span>
                  <div class="detail__text">
                    <span class="eyebrow">Album</span>
                    <h2>{{ d.album }}</h2>
                    <p class="detail__meta">
                      <button type="button" class="link" (click)="openArtist(d.artist)">{{ d.artist }}</button>
                      · {{ detailMeta() }}
                    </p>
                  </div>
                  <div class="detail__actions">
                    <button type="button" class="btn" (click)="playDetail(false)"><sc-icon name="play" /> Play</button>
                    <button type="button" class="btn" (click)="playDetail(true)"><sc-icon name="shuffle" /> Shuffle</button>
                    @if (downloads.supported) {
                      <button type="button" class="btn btn--quiet" [disabled]="downloads.isBatchRunning()" (click)="downloadDetail()">
                        <sc-icon name="download" /> Download
                      </button>
                    }
                  </div>
                </header>
                <ol class="detail-tracks">
                  @for (track of detailTracks(); track track.id; let index = $index) {
                    <li
                      class="detail-track"
                      [class.is-current]="playback.track()?.id === track.id"
                      [class.is-missing]="track.missing"
                      (click)="play(track, detailTracks())"
                      (contextmenu)="openContextMenu(track, $event, detailTracks())"
                    >
                      <span class="detail-track__no">
                        @if (playback.track()?.id === track.id && playback.isPlaying()) {
                          <span class="equalizer" aria-label="Now playing"><i></i><i></i><i></i></span>
                        } @else {
                          {{ track.trackNo ?? index + 1 }}
                        }
                      </span>
                      <span class="detail-track__title">
                        {{ track.title }}
                        @if (downloads.isDownloaded()(track.id)) {
                          <span class="dl-badge" title="Available offline"><sc-icon name="download" /></span>
                        }
                        @if (track.artist !== d.artist) {
                          <span class="detail-track__artist">{{ track.artist }}</span>
                        }
                      </span>
                      <span class="detail-track__time">{{ formatDuration(track.durationMs) }}</span>
                      <button
                        type="button"
                        class="icon-btn"
                        [attr.aria-label]="'More actions for ' + track.title"
                        title="More"
                        (click)="openContextMenu(track, $event, detailTracks()); $event.stopPropagation()"
                      >
                        <sc-icon name="down" />
                      </button>
                    </li>
                  }
                </ol>
              }
            </div>
          } @else if (mode() === 'albums') {
            <div class="album-grid">
              @for (album of library.albums(); track album.album + album.artist; let index = $index) {
                <button type="button" class="album-card" [style.--i]="index" (click)="openAlbum(album.album, album.artist, false)">
                  <span class="album-card__art">
                    <sc-artwork [src]="album.artwork" [altText]="album.album" size="hero" />
                  </span>
                  <span class="album-card__name">{{ album.album }}</span>
                  <span class="album-card__artist">{{ album.artist }}</span>
                  <span class="album-card__count">{{ album.tracks }} track{{ album.tracks === 1 ? '' : 's' }}</span>
                </button>
              }
            </div>
          } @else {
            <div class="artist-grid">
              @for (artist of artists(); track artist.artist; let index = $index) {
                <button type="button" class="artist-card" [style.--i]="index" (click)="openArtist(artist.artist)">
                  <span class="artist-card__avatar">
                    @if (artist.artwork) {
                      <sc-artwork [src]="artist.artwork" [altText]="artist.artist" size="hero" />
                    } @else {
                      <span class="artist-card__initial">{{ artist.artist.charAt(0).toUpperCase() }}</span>
                    }
                  </span>
                  <span class="artist-card__name">{{ artist.artist }}</span>
                  <span class="artist-card__count">{{ artist.albums }} album{{ artist.albums === 1 ? '' : 's' }} · {{ artist.tracks }} tracks</span>
                </button>
              }
            </div>
          }
        </div>
      }

      <div class="context-layer" #contextLayer>
      @if (contextMenu(); as menu) {
        <div class="context-backdrop" (click)="closeContextMenu()" (contextmenu)="$event.preventDefault()"></div>
        <div class="context-menu" [style.left.px]="menu.x" [style.top.px]="menu.y" role="menu">
          <button type="button" role="menuitem" (click)="play(menu.track, menu.queue); closeContextMenu()">Play</button>
          <button type="button" role="menuitem" (click)="playNext(menu.track); closeContextMenu()">Play next</button>
          <button type="button" role="menuitem" (click)="enqueue(menu.track); closeContextMenu()">Add to queue</button>
          <button type="button" role="menuitem" (click)="startRadio(menu.track); closeContextMenu()">Start radio</button>
          <button type="button" role="menuitem" (click)="saveRadio(menu.track); closeContextMenu()">Save radio as playlist</button>
          <button type="button" role="menuitem" (click)="favorites.toggle(menu.track.id); closeContextMenu()">
            {{ favorites.isFavorite()(menu.track.id) ? 'Unfavorite' : 'Favorite' }}
          </button>
          @if (downloads.supported && menu.track.sourceId !== 'local') {
            <button type="button" role="menuitem" (click)="toggleDownload(menu.track); closeContextMenu()">
              {{ downloads.isDownloaded()(menu.track.id) ? 'Remove download' : 'Download for offline' }}
            </button>
          }
          @if (menu.track.sourceId === 'local') {
            <button type="button" role="menuitem" class="danger" (click)="remove(menu.track); closeContextMenu()">Remove from library</button>
          }
        </div>
      }
      </div>
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
      @media (max-width: 720px) {
        .eyebrow,
        .lede {
          display: none;
        }
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
      .empty__setup {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: center;
        margin-top: 10px;
      }
      .empty__setup-hint {
        color: var(--muted);
        font-size: 0.82rem;
        margin: 0;
      }
      .empty__jellyfin {
        display: grid;
        gap: 12px;
        width: 100%;
        max-width: 520px;
        margin-top: 14px;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--surface-3);
      }
      .browser {
        display: grid;
        gap: 14px;
      }
      .mode-tabs {
        display: flex;
        gap: 4px;
        padding: 4px;
        border-radius: 14px;
        background: var(--surface-1);
        border: 1px solid var(--line);
        width: fit-content;
        max-width: 100%;
        overflow-x: auto;
      }
      .mode-tabs button {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 0;
        background: none;
        color: var(--muted);
        font: inherit;
        font-size: 0.84rem;
        padding: 8px 16px;
        border-radius: 10px;
        cursor: pointer;
        white-space: nowrap;
        transition: color 140ms ease, background 140ms ease;
      }
      .mode-tabs button span {
        font-size: 0.66rem;
        color: var(--muted);
        background: rgba(148, 197, 255, 0.1);
        padding: 1px 7px;
        border-radius: 999px;
      }
      .mode-tabs button.is-active {
        color: var(--on-accent);
        /* Solid fallback keeps the text legible for audits that cannot
           resolve a gradient; the gradient is the visible surface. */
        background-color: var(--cyan);
        background-image: linear-gradient(120deg, var(--cyan), var(--cyan-soft));
        font-weight: 600;
        box-shadow: 0 4px 16px rgba(56, 225, 255, 0.32);
      }
      .mode-tabs button.is-active span {
        /* A light pill reads clearly on both the bright dark-theme accent and
           the deeper light-theme accent. */
        color: #04202e;
        background: rgba(255, 255, 255, 0.92);
      }
      .detail {
        display: grid;
        gap: 20px;
      }
      .detail__back {
        justify-self: start;
      }
      .detail__head {
        display: flex;
        align-items: flex-end;
        gap: clamp(14px, 2.4vw, 28px);
        flex-wrap: wrap;
      }
      .detail__cover,
      .detail__avatar {
        display: block;
        flex: none;
        width: clamp(96px, 16vw, 160px);
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 18px 44px rgba(0, 6, 20, 0.45);
      }
      .detail__avatar {
        display: grid;
        place-items: center;
        aspect-ratio: 1;
        border-radius: 50%;
        background: linear-gradient(140deg, rgba(56, 225, 255, 0.24), rgba(167, 139, 250, 0.24));
      }
      .detail__text {
        flex: 1;
        min-width: 180px;
      }
      .detail__text h2 {
        font-size: clamp(1.5rem, 3vw, 2.4rem);
        letter-spacing: -0.02em;
        margin: 2px 0 6px;
      }
      .detail__meta {
        color: var(--muted);
        margin: 0;
        font-size: 0.86rem;
      }
      .detail__meta .link {
        background: none;
        border: 0;
        padding: 0;
        color: inherit;
        font: inherit;
        text-decoration: underline;
        text-underline-offset: 3px;
        cursor: pointer;
      }
      .detail__actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .detail-tracks {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
      }
      .detail-track {
        display: grid;
        grid-template-columns: 36px 1fr auto auto;
        align-items: center;
        gap: 12px;
        padding: 10px 8px;
        border-bottom: 1px solid var(--line);
        border-radius: 8px;
        cursor: pointer;
      }
      .detail-track:hover {
        background: var(--surface-2);
      }
      .detail-track.is-current .detail-track__title {
        color: var(--accent, #38e1ff);
      }
      .detail-track.is-missing {
        opacity: 0.5;
      }
      .detail-track__no,
      .detail-track__time {
        color: var(--muted);
        font-variant-numeric: tabular-nums;
        font-size: 0.82rem;
        text-align: right;
      }
      .detail-track__title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
      }
      .detail-track__artist {
        margin-left: 8px;
        color: var(--muted);
        font-weight: 400;
        font-size: 0.78rem;
      }
      .filter-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 14px;
        border-radius: 12px;
        border: 1px solid rgba(56, 225, 255, 0.22);
        background: rgba(56, 225, 255, 0.05);
        font-size: 0.82rem;
      }
      .filter-bar__label {
        color: var(--muted);
      }
      .album-grid,
      .artist-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 16px;
      }
      .album-card {
        display: grid;
        gap: 6px;
        text-align: left;
        background: none;
        border: 0;
        padding: 0;
        color: inherit;
        cursor: pointer;
        min-width: 0;
        animation: card-in 460ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
        animation-delay: min(calc(var(--i, 0) * 24ms), 480ms);
      }
      .album-card__art {
        display: block;
        border-radius: 14px;
        overflow: hidden;
        box-shadow: 0 12px 30px rgba(0, 6, 20, 0.35);
        transition: box-shadow 300ms ease;
      }
      .album-card__art sc-artwork {
        display: block;
        transition: transform 560ms cubic-bezier(0.2, 0.7, 0.2, 1);
      }
      .album-card:hover .album-card__art {
        box-shadow: 0 22px 48px rgba(0, 8, 26, 0.55);
      }
      .album-card:hover .album-card__art sc-artwork {
        transform: scale(1.055);
      }
      .album-card__name {
        font-weight: 600;
        font-size: 0.86rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .album-card__artist,
      .album-card__count {
        color: var(--muted);
        font-size: 0.76rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .album-card__count {
        font-size: 0.66rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .artist-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        text-align: center;
        background: var(--surface-2);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 20px 12px;
        color: inherit;
        cursor: pointer;
        transition: border-color 160ms ease, background 160ms ease, transform 200ms ease, box-shadow 200ms ease;
        animation: card-in 460ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
        animation-delay: min(calc(var(--i, 0) * 24ms), 480ms);
      }
      .artist-card:hover {
        border-color: rgba(56, 225, 255, 0.4);
        background: var(--surface-3);
        transform: translateY(-3px);
        box-shadow: 0 18px 42px rgba(0, 8, 26, 0.42);
      }
      .artist-card__avatar {
        position: relative;
        display: grid;
        place-items: center;
        width: 64px;
        height: 64px;
        border-radius: 50%;
        overflow: hidden;
        background: linear-gradient(140deg, rgba(56, 225, 255, 0.24), rgba(167, 139, 250, 0.24));
      }
      .artist-card__avatar sc-artwork {
        width: 100%;
        height: 100%;
      }
      .artist-card__initial {
        font-size: 1.4rem;
        font-weight: 600;
        color: var(--text);
      }
      .artist-card__name {
        font-weight: 600;
        font-size: 0.86rem;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .artist-card__count {
        color: var(--muted);
        font-size: 0.68rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
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
      .icon-btn--active {
        color: var(--cyan);
        background: rgba(56, 225, 255, 0.14);
      }
      .icon-btn--danger:hover {
        color: var(--danger);
        background: rgba(255, 107, 138, 0.12);
      }
      .icon-btn--busy {
        cursor: progress;
        opacity: 1;
        color: var(--cyan);
      }
      /* Conic ring filled to the reported fraction of the download. */
      .dl-ring {
        --progress: 0%;
        width: 15px;
        height: 15px;
        border-radius: 50%;
        background:
          conic-gradient(var(--cyan) var(--progress), rgba(255, 255, 255, 0.16) var(--progress));
        mask: radial-gradient(circle, transparent 4px, #000 4.5px);
        -webkit-mask: radial-gradient(circle, transparent 4px, #000 4.5px);
      }
      .dl-badge {
        display: inline-flex;
        align-items: center;
        vertical-align: -2px;
        margin-left: 6px;
        color: var(--cyan);
        font-size: 0.72em;
      }
      .chip-toggle {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border: 1px solid var(--line);
        background: var(--surface-1);
        color: var(--muted);
        font: inherit;
        font-size: 0.8rem;
        padding: 7px 13px;
        border-radius: 999px;
        cursor: pointer;
        transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
      }
      .chip-toggle:hover {
        color: var(--text);
      }
      .chip-toggle.is-active {
        color: #04131f;
        background: linear-gradient(120deg, var(--cyan), #7fd4ff);
        border-color: transparent;
        font-weight: 600;
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
      .selection-bar {
        position: sticky;
        top: 0;
        z-index: 20;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid rgba(56, 225, 255, 0.22);
        background: rgba(11, 18, 36, 0.92);
        backdrop-filter: blur(8px);
      }
      .select-all {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.84rem;
        color: var(--text);
      }
      .col-select {
        width: 36px;
        text-align: center;
      }
      .col-select input {
        width: 16px;
        height: 16px;
        accent-color: var(--cyan);
      }
      .track-row.is-selected {
        background: rgba(56, 225, 255, 0.06);
      }
      .context-backdrop {
        position: fixed;
        inset: 0;
        z-index: 300;
      }
      .context-menu {
        position: fixed;
        z-index: 301;
        min-width: 180px;
        max-width: calc(100vw - 16px);
        max-height: calc(100vh - 16px);
        overflow-y: auto;
        padding: 6px;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: var(--panel-strong, #0b1224);
        backdrop-filter: blur(18px);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
        display: grid;
        gap: 2px;
      }
      @media (max-width: 640px) {
        .context-menu {
          left: 8px !important;
          right: 8px;
          top: auto !important;
          bottom: 8px;
          max-height: 70vh;
        }
      }

      .context-menu button {
        text-align: left;
        padding: 8px 12px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: var(--text);
        cursor: pointer;
        font-size: 0.86rem;
      }
      .context-menu button:hover {
        background: rgba(255, 255, 255, 0.06);
      }
      .context-menu button.danger {
        color: var(--danger);
      }
      .track-row {
        touch-action: none;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
      }
      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(10px) scale(0.995);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @keyframes card-in {
        from {
          opacity: 0;
          transform: translateY(14px) scale(0.98);
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
export class LibraryViewComponent implements AfterViewInit, OnDestroy {
  private readonly contextLayer = viewChild.required<ElementRef<HTMLElement>>('contextLayer');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // The menu is position:fixed, but an animated ancestor makes it relative to (and clipped by)
  // the scroll area, hiding it behind the mini-player. Hosting it on <body> avoids that.
  ngAfterViewInit(): void {
    document.body.appendChild(this.contextLayer().nativeElement);
  }

  ngOnDestroy(): void {
    this.contextLayer().nativeElement.remove();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const menu = this.contextMenu();
    if (!menu) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.context-menu')) return;
    this.closeContextMenu();
  }
  protected readonly library = inject(LibraryStore);
  protected readonly downloads = inject(DownloadsStore);
  protected readonly favorites = inject(FavoritesStore);
  protected readonly playlists = inject(PlaylistsStore);
  protected readonly playback = inject(PlaybackStore);
  protected readonly radio = inject(RadioStore);
  protected readonly toasts = inject(ToastStore);
  protected readonly isNative = isNativePlatform;
  protected readonly formatDuration = formatDuration;
  protected readonly formatLabel = formatLabel;
  protected readonly pluralize = pluralize;

  protected readonly search = signal('');
  /** Open drill-down page: an artist's albums, or an album's tracks (viaArtist: opened from the artist page). */
  protected readonly detail = signal<
    { kind: 'artist'; artist: string } | { kind: 'album'; album: string; artist: string; viaArtist: boolean } | null
  >(null);
  protected readonly sort = signal<SortKey>('artist');
  protected readonly mode = signal<'tracks' | 'albums' | 'artists'>('tracks');
  protected readonly showJellyfinSetup = signal(false);
  protected readonly offlineOnly = signal(false);
  protected readonly selectMode = signal(false);
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly selectedCount = computed(() => this.selected().size);
  protected readonly contextMenu = signal<{ x: number; y: number; track: Track; queue?: Track[] } | null>(null);
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressMoved = false;
  private longPressStart: { x: number; y: number } | null = null;
  protected readonly allVisibleSelected = computed(() => {
    const visible = this.filtered().map((t) => t.id);
    if (visible.length === 0) return false;
    const sel = this.selected();
    return visible.every((id) => sel.has(id));
  });

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
    const offlineOnly = this.offlineOnly();
    const isDownloaded = this.downloads.isDownloaded();
    const rows = this.library.tracks().filter((track) => {
      // "Offline" means it plays with no network: a pinned download or a file
      // imported onto this device.
      if (offlineOnly && !isDownloaded(track.id) && track.sourceId !== 'local') return false;
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

  protected readonly artists = computed(() => {
    const map = new Map<string, { albums: Set<string>; tracks: number; artwork: string | null; photo: string | null }>();
    for (const track of this.library.tracks()) {
      const key = track.albumArtist ?? track.artist;
      const entry = map.get(key) ?? { albums: new Set<string>(), tracks: 0, artwork: null, photo: null };
      entry.albums.add(track.album);
      entry.tracks += 1;
      entry.artwork ??= track.artworkUrl;
      entry.photo ??= track.artistArtworkUrl ?? null;
      map.set(key, entry);
    }
    return [...map.entries()]
      .map(([artist, entry]) => ({
        artist,
        albums: entry.albums.size,
        tracks: entry.tracks,
        artwork: entry.photo ?? entry.artwork,
      }))
      .sort((a, b) => a.artist.localeCompare(b.artist));
  });

  /** Tracks on the open page, in play order: an album by track number, an artist by album then track. */
  protected readonly detailTracks = computed(() => {
    const d = this.detail();
    if (!d) return [] as Track[];
    const rows = this.library.tracks().filter((t) => (t.albumArtist ?? t.artist) === d.artist && (d.kind === 'artist' || t.album === d.album));
    return rows.sort(
      (a, b) =>
        (d.kind === 'artist' ? a.album.localeCompare(b.album) : 0) ||
        (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
        a.title.localeCompare(b.title),
    );
  });

  protected readonly detailAlbums = computed(() => {
    const d = this.detail();
    return d?.kind === 'artist' ? this.library.albums().filter((a) => a.artist === d.artist) : [];
  });

  protected readonly detailArtwork = computed(() => {
    const d = this.detail();
    if (!d) return null;
    if (d.kind === 'artist') return this.artists().find((a) => a.artist === d.artist)?.artwork ?? null;
    return this.library.albums().find((a) => a.album === d.album && a.artist === d.artist)?.artwork ?? null;
  });

  protected readonly detailMeta = computed(() => {
    const d = this.detail();
    const tracks = this.detailTracks();
    const minutes = Math.max(1, Math.round(tracks.reduce((sum, t) => sum + t.durationMs, 0) / 60000));
    const base = `${tracks.length} track${tracks.length === 1 ? '' : 's'} · ${minutes} min`;
    if (d?.kind === 'artist') {
      const albums = this.detailAlbums().length;
      return `${albums} album${albums === 1 ? '' : 's'} · ${base}`;
    }
    const year = tracks.find((t) => t.year)?.year;
    return year ? `${year} · ${base}` : base;
  });

  protected readonly backLabel = computed(() => {
    const d = this.detail();
    if (d?.kind === 'album' && d.viaArtist) return d.artist;
    return this.mode() === 'artists' ? 'Artists' : 'Albums';
  });

  protected setMode(mode: 'tracks' | 'albums' | 'artists'): void {
    this.mode.set(mode);
    this.detail.set(null);
  }

  protected openAlbum(album: string, artist: string, viaArtist: boolean): void {
    this.detail.set({ kind: 'album', album, artist, viaArtist });
    this.scrollToTop();
  }

  protected openArtist(artist: string): void {
    this.mode.set('artists');
    this.detail.set({ kind: 'artist', artist });
    this.scrollToTop();
  }

  protected closeDetail(): void {
    const d = this.detail();
    this.detail.set(d?.kind === 'album' && d.viaArtist ? { kind: 'artist', artist: d.artist } : null);
    this.scrollToTop();
  }

  protected clearFilters(): void {
    this.search.set('');
  }

  private scrollToTop(): void {
    setTimeout(() => this.host.nativeElement.scrollIntoView?.({ block: 'start' }));
  }

  protected async playDetail(shuffle: boolean): Promise<void> {
    const ids = this.detailTracks().map((t) => t.id);
    if (ids.length === 0) return;
    if (!shuffle) {
      await this.playback.playTrack(ids[0], ids);
      return;
    }
    if (!this.playback.snapshot().shuffle) await this.playback.toggleShuffle();
    await this.playback.playTrack(ids[Math.floor(Math.random() * ids.length)], ids);
  }

  protected downloadDetail(): void {
    this.downloadTracks(this.detailTracks());
  }

  protected play(track: Track, queue: Track[] = this.filtered()): void {
    void this.playback.playTrack(track.id, queue.map((t) => t.id));
  }

  protected async shuffleAll(): Promise<void> {
    const ids = this.filtered().map((t) => t.id);
    if (ids.length === 0) return;
    if (!this.playback.snapshot().shuffle) await this.playback.toggleShuffle();
    const start = ids[Math.floor(Math.random() * ids.length)];
    await this.playback.playTrack(start, ids);
  }

  protected playNext(track: Track): void {
    void this.playback.playNext(track.id);
  }

  protected startRadio(track: Track): void {
    void this.radio.start(track);
  }

  protected saveRadio(track: Track): void {
    void this.radio.saveAsPlaylist(track);
  }

  protected enqueue(track: Track): void {
    void this.playback.enqueue([track.id]);
  }

  protected remove(track: Track): void {
    // Imported Android tracks are a copy Statocyst owns, so removing one frees
    // the storage it occupies. Desktop imports point at the original file and
    // only drop the index entry.
    const message =
      this.isNative() && track.sourceId === 'local'
        ? `Remove “${track.title}” from the device? The imported copy is deleted.`
        : `Remove “${track.title}” from the library? The audio file itself is not deleted.`;
    if (window.confirm(message)) void this.library.removeTrack(track);
  }

  /**
   * Progress-ring fill for an in-flight download. The reported size can be
   * unknown for the first moment, in which case the ring stays empty rather
   * than being handed an invalid custom-property value.
   */
  protected downloadPercent(trackId: string): string {
    if (!this.downloads.isDownloading()(trackId)) return '0%';
    const fraction = this.downloads.trackFraction()(trackId) ?? this.downloads.activePercent();
    return fraction == null ? '0%' : `${Math.round(fraction * 100)}%`;
  }

  private downloadTracks(tracks: Track[]): void {
    void this.downloads.downloadMany(
      tracks.map((track) => track.id),
      (id) => tracks.find((track) => track.id === id)?.title ?? '',
    );
  }

  protected onRowPointerDown(track: Track, event: PointerEvent): void {
    if (this.selectMode()) return;
    this.longPressMoved = false;
    this.longPressStart = { x: event.clientX, y: event.clientY };
    this.longPressTimer = setTimeout(() => {
      if (this.longPressMoved) return;
      this.selectMode.set(true);
      this.toggleSelect(track.id);
      // haptic-ish feedback via vibration if available
      try { (navigator as any).vibrate?.(15); } catch { /* ignore */ }
    }, 450);
  }

  protected onRowPointerMove(event: PointerEvent): void {
    if (!this.longPressStart) return;
    const dx = Math.abs(event.clientX - this.longPressStart.x);
    const dy = Math.abs(event.clientY - this.longPressStart.y);
    if (dx > 10 || dy > 10) this.longPressMoved = true;
  }

  protected onRowPointerUp(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressStart = null;
  }

  protected onRowClick(track: Track, event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, a')) return;
    if (!this.selectMode()) return;
    event.preventDefault();
    this.toggleSelect(track.id);
  }

  protected openContextMenu(track: Track, event: MouseEvent, queue?: Track[]): void {
    event.preventDefault();
    // Keep the menu on-screen: phones are narrower/shorter than the menu.
    const margin = 8;
    const width = 260;
    const height = 420;
    const x = Math.max(margin, Math.min(event.clientX, window.innerWidth - width - margin));
    const y = Math.max(margin, Math.min(event.clientY, window.innerHeight - height - margin));
    this.contextMenu.set({ x, y, track, queue });
  }

  protected closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  protected toggleSelectMode(): void {
    this.selectMode.update((v) => !v);
    if (!this.selectMode()) this.selected.set(new Set());
  }

  protected toggleSelect(trackId: string): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

  protected toggleSelectAll(): void {
    if (this.allVisibleSelected()) {
      this.selected.update((set) => {
        const next = new Set(set);
        for (const id of this.filtered().map((t) => t.id)) next.delete(id);
        return next;
      });
    } else {
      this.selected.update((set) => {
        const next = new Set(set);
        for (const id of this.filtered().map((t) => t.id)) next.add(id);
        return next;
      });
    }
  }

  protected clearSelectionAndExit(): void {
    this.selected.set(new Set());
    this.selectMode.set(false);
  }

  protected downloadSelected(): void {
    const ids = [...this.selected()];
    const tracks = this.library.tracks().filter((t) => ids.includes(t.id));
    void this.downloads.downloadMany(ids, (id) => tracks.find((t) => t.id === id)?.title ?? '');
  }

  protected favoriteSelected(): void {
    for (const id of this.selected()) this.favorites.toggle(id);
    this.toasts?.success('Favorites updated', `${this.selected().size} track(s).`);
    this.clearSelectionAndExit();
  }

  protected saveSelectionAsPlaylist(): void {
    const ids = [...this.selected()];
    const name = window.prompt('Name this playlist', `Selection (${ids.length})`);
    if (!name) return;
    this.playlists.create(name, ids);
    this.toasts?.success('Playlist saved', name);
    this.clearSelectionAndExit();
  }

  protected toggleDownload(track: Track): void {
    if (this.downloads.isDownloaded()(track.id)) {
      void this.downloads.remove(track.id, track.title);
    } else {
      void this.downloads.download(track.id, track.title);
    }
  }
}
