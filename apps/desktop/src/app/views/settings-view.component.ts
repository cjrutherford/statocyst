import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import type {
  AppInfo,
  CacheStats,
  DiagnosticsInfo,
  DensityPreference,
  HealthCheck,
  QualityPreference,
  Settings,
  ThemePreference,
} from '@statocyst/contracts';
import { IconComponent } from '../components/icon.component';
import { JellyfinPanelComponent } from '../components/jellyfin-panel.component';
import { bridge, isNativePlatform } from '../core/bridge';
import { SettingsStore } from '../core/settings.store';
import { DownloadsStore } from '../core/downloads.store';
import { LibraryStore } from '../core/library.store';
import { ToastStore } from '../core/toast.store';
import { formatBytes } from '../core/format';

@Component({
  selector: 'sc-settings-view',
  standalone: true,
  imports: [IconComponent, JellyfinPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="view" aria-labelledby="settings-heading">
      <header class="view__head">
        <div>
          <p class="eyebrow">Preferences</p>
          <h1 id="settings-heading">Settings</h1>
          <p class="lede">Appearance, diagnostics and the local data boundary.</p>
        </div>
        <button type="button" class="btn btn--quiet" (click)="refresh()">
          <sc-icon name="refresh" /> Refresh diagnostics
        </button>
      </header>

      <div class="grid">
        <section class="card" aria-labelledby="appearance-heading">
          <h2 id="appearance-heading">Appearance</h2>
          <p class="card__hint">
            @if (isNative()) {
              The shell follows your device theme by default.
            } @else {
              The shell follows your desktop theme by default.
            }
          </p>

          <div class="field">
            <span class="field__label" id="theme-label">Theme</span>
            <div class="segmented" role="radiogroup" aria-labelledby="theme-label">
              @for (option of themes; track option.value) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="settings.settings().theme === option.value"
                  [class.is-active]="settings.settings().theme === option.value"
                  (click)="setTheme(option.value)"
                >
                  {{ option.label }}
                </button>
              }
            </div>
          </div>

          <div class="field">
            <span class="field__label" id="density-label">Density</span>
            <div class="segmented" role="radiogroup" aria-labelledby="density-label">
              @for (option of densities; track option.value) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="settings.settings().density === option.value"
                  [class.is-active]="settings.settings().density === option.value"
                  (click)="setDensity(option.value)"
                >
                  {{ option.label }}
                </button>
              }
            </div>
          </div>

          <div class="field">
            <span class="field__label" id="quality-label">Streaming quality</span>
            <div class="segmented" role="radiogroup" aria-labelledby="quality-label">
              @for (option of qualities; track option.value) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="settings.settings().quality === option.value"
                  [class.is-active]="settings.settings().quality === option.value"
                  (click)="setQuality(option.value)"
                >
                  {{ option.label }}
                </button>
              }
            </div>
            <p class="card__hint">
              {{ settings.settings().quality === 'lossless'
                ? 'Direct play whenever the device and network allow it.'
                : 'Allow policy-driven transcoding when throughput drops.' }}
            </p>
          </div>
        </section>

        @if (isNative()) {
        <section class="card" aria-labelledby="car-heading">
          <h2 id="car-heading">Car and Android Auto</h2>
          <p class="card__hint">
            Statocyst appears in Android Auto as a media app: browse Recents, Favorites, Playlists,
            Radio, Albums, Artists and Tracks from the head unit, or ask Assistant to play something.
          </p>
          <ol class="car-steps">
            <li>Open your phone's Android Auto settings and tap the version number ten times to enable developer settings.</li>
            <li>In the developer settings, turn on <strong>Unknown sources</strong> (this build is installed outside Google Play).</li>
            <li>Back in Android Auto settings, choose <strong>Customize launcher</strong> and make sure Statocyst is ticked.</li>
            <li>Reconnect to the car. Statocyst appears in the media app list.</li>
          </ol>
          @if (browseAccess(); as access) {
            <h3 class="section-label">Head units and controllers</h3>
            @if (access.denied.length === 0 && access.allowed.length === 0) {
              <p class="card__hint">
                None blocked. If your head unit shows an empty browse list, reconnect it and come
                back: a blocked app will be listed here so you can allow it.
              </p>
            }
            @for (pkg of access.denied; track pkg) {
              <div class="access-row">
                <code>{{ pkg }}</code>
                <span class="card__hint">Blocked</span>
                <button type="button" class="btn" (click)="setBrowseAllowed(pkg, true)">Allow</button>
              </div>
            }
            @for (pkg of access.allowed; track pkg) {
              <div class="access-row">
                <code>{{ pkg }}</code>
                <span class="card__hint">Allowed</span>
                <button type="button" class="btn btn--quiet" (click)="setBrowseAllowed(pkg, false)">Remove</button>
              </div>
            }
          }
          <p class="card__hint">
            Tips: say "play radio like <em>song</em>" to start a song radio, or use the Shuffle and
            Repeat buttons on the head unit. Browse is limited to the Android Auto system and
            Google Assistant; other apps stay blocked until you allow them above.
          </p>
        </section>
        }

        @if (!isNative()) {
        <section class="card" aria-labelledby="shortcuts-heading">
          <h2 id="shortcuts-heading">Keyboard</h2>
          <p class="card__hint">Shortcuts stay inside the player, never the system.</p>
          <dl class="shortcuts">
            <div><dt><kbd>Space</kbd></dt><dd>Play or pause</dd></div>
            <div><dt><kbd>→</kbd> <kbd>←</kbd></dt><dd>Seek five seconds</dd></div>
            <div><dt><kbd>N</kbd> / <kbd>P</kbd></dt><dd>Next / previous track</dd></div>
            <div><dt><kbd>M</kbd></dt><dd>Mute</dd></div>
            <div><dt><kbd>S</kbd></dt><dd>Toggle shuffle</dd></div>
            <div><dt><kbd>R</kbd></dt><dd>Cycle repeat mode</dd></div>
            <div><dt><kbd>/</kbd></dt><dd>Focus library search</dd></div>
          </dl>
        </section>
        }

        <section class="card card--wide" aria-labelledby="diagnostics-heading">
          <div class="card__head">
            <div>
              <h2 id="diagnostics-heading">Local data and diagnostics</h2>
              <p class="card__hint">
                @if (isNative()) {
                  Everything below is stored on this device. Statocyst makes no network request
                  for local playback.
                } @else {
                  Everything below is stored on this machine. Statocyst makes no network request
                  for local playback.
                }
              </p>
            </div>
            <span
              class="health"
              [class.health--ok]="diagnostics()?.integrity === 'ok'"
              [class.health--bad]="diagnostics()?.integrity === 'failed'"
            >
              <sc-icon name="check" />
              {{ diagnostics()?.integrity === 'ok' ? 'Database healthy' : 'Database unknown' }}
            </span>
          </div>

          @if (diagnostics(); as data) {
            <dl class="facts">
              <div>
                <dt>Database</dt>
                <dd class="path" [title]="data.databasePath">{{ data.databasePath }}</dd>
              </div>
              @if (data.logPath) {
                <div>
                  <dt>Log file</dt>
                  <dd class="path" [title]="data.logPath">{{ data.logPath }}</dd>
                </div>
              }
              <div><dt>Database size</dt><dd>{{ formatBytes(data.databaseBytes) }}</dd></div>
              <div><dt>Cache size</dt><dd>{{ formatBytes(data.cacheBytes) }}</dd></div>
              <div><dt>Schema version</dt><dd>{{ data.schemaVersion }}</dd></div>
              <div><dt>Queue entries</dt><dd>{{ data.queueEntries }}</dd></div>
              <div><dt>Catalogued tracks</dt><dd>{{ data.trackCount }}</dd></div>
              @if (info(); as app) {
                @if (isNative()) {
                  <div><dt>WebView</dt><dd>{{ app.chrome }}</dd></div>
                  <div><dt>Version</dt><dd>{{ app.version }}</dd></div>
                } @else {
                  <div><dt>Electron</dt><dd>{{ app.electron }}</dd></div>
                  <div><dt>Chromium</dt><dd>{{ app.chrome }}</dd></div>
                  <div><dt>Node</dt><dd>{{ app.node }}</dd></div>
                }
                <div><dt>Platform</dt><dd>{{ app.platform }}</dd></div>
              }
            </dl>
          } @else {
            <p class="card__hint">Reading diagnostics…</p>
          }

          <h3 class="section-label">Local health checks</h3>
          @if (health().length > 0) {
            <ul class="checks">
              @for (check of health(); track check.id) {
                <li class="check" [attr.data-status]="check.status">
                  <sc-icon [name]="check.status === 'fail' ? 'close' : check.status === 'warn' ? 'alert' : 'check'" />
                  <span class="check__body">
                    <strong>{{ check.label }}</strong>
                    <span>{{ check.detail }}</span>
                  </span>
                </li>
              }
            </ul>
          } @else {
            <p class="card__hint">Running local checks…</p>
          }

          <div class="card__actions">
            @if (!isNative()) {
              <button type="button" class="btn" (click)="openDataFolder()">
                <sc-icon name="folder" /> Open data folder
              </button>
            }
            <button type="button" class="btn" (click)="exportBundle()">
              <sc-icon name="download" /> Export support bundle
            </button>
            @if (!isNative()) {
              <button type="button" class="btn btn--danger" (click)="quit()">
                <sc-icon name="close" /> Quit Statocyst
              </button>
            }
          </div>
        </section>

        <section class="card card--wide" aria-labelledby="privacy-heading">
          <div class="card__head">
            <div>
              <h2 id="privacy-heading">Privacy</h2>
              <p class="card__hint">
                Logs stay in the data folder and secrets are redacted before they are written.
                Nothing is uploaded, and there is no third-party analytics.
              </p>
            </div>
          </div>

          <label class="toggle-row">
            <input
              type="checkbox"
              [checked]="settings.settings().listeningHistory"
              (change)="setListeningHistory($event)"
            />
            <span class="toggle-row__text">
              <strong>Save local listening history</strong>
              <span>
                Records play counts and last-played dates in the local database so you can see
                what you have heard. Off by default; never sent to a server.
              </span>
            </span>
          </label>

          @if (externalArtwork() !== null) {
            <label class="toggle-row">
              <input
                type="checkbox"
                [checked]="externalArtwork()"
                (change)="setExternalArtwork($event)"
              />
              <span class="toggle-row__text">
                <strong>Fetch missing artwork online</strong>
                <span>
                  Looks up cover art and artist photos on MusicBrainz, the Cover Art Archive and
                  Wikimedia Commons for songs that have none. This sends the artist and album names
                  (not your files or account) to those services. Off by default; found images are
                  cached on this device.
                </span>
              </span>
            </label>
          }

          <p class="card__hint">
            Turning this off stops new history from being written. Existing counts remain in the
            local database until you delete it.
          </p>
        </section>

        <section class="card card--wide" aria-labelledby="cache-heading">
          <div class="card__head">
            <div>
              <h2 id="cache-heading">Rolling cache</h2>
              <p class="card__hint">
                Recently streamed audio is kept locally up to the budget below. It is evicted
                least-recently-used first and never includes your pinned downloads.
              </p>
            </div>
            @if (cacheStats(); as cache) {
              <span class="health" [class.health--bad]="cache.pressure">
                <sc-icon [name]="cache.pressure ? 'alert' : 'check'" />
                {{ formatBytes(cache.bytes) }} of {{ formatBytes(cache.budgetBytes) }}
              </span>
            }
          </div>

          <div class="field">
            <span class="field__label" id="budget-label">Cache budget</span>
            <div class="segmented" role="radiogroup" aria-labelledby="budget-label">
              @for (option of budgets; track option.value) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="settings.settings().cacheBudgetBytes === option.value"
                  [class.is-active]="settings.settings().cacheBudgetBytes === option.value"
                  (click)="setCacheBudget(option.value)"
                >
                  {{ option.label }}
                </button>
              }
            </div>
          </div>

          @if (cacheStats(); as cache) {
            <dl class="facts">
              <div><dt>Cached tracks</dt><dd>{{ cache.entries }}</dd></div>
              <div><dt>Cache used</dt><dd>{{ formatBytes(cache.bytes) }}</dd></div>
              <div>
                <dt>Storage pressure</dt>
                <dd>{{ cache.pressure ? 'Budget reduced to protect free space' : 'None detected' }}</dd>
              </div>
            </dl>
          } @else {
            <p class="card__hint">Reading cache state…</p>
          }

          <div class="card__actions">
            <button type="button" class="btn btn--quiet" (click)="reconcileCache()">
              <sc-icon name="refresh" /> Check cache files
            </button>
            <button type="button" class="btn btn--danger" (click)="clearCache()">
              <sc-icon name="trash" /> Clear cache
            </button>
          </div>
        </section>

        <section class="card card--wide" aria-labelledby="downloads-heading">
          <div class="card__head">
            <div>
              <h2 id="downloads-heading">Downloads</h2>
              <p class="card__hint">
                @if (downloads.supported) {
                  Pinned tracks are kept on this device and play without a network connection.
                  They are never evicted by the cache.
                } @else {
                  This build cannot keep offline downloads, so nothing here is pinned to the
                  device.
                }
              </p>
            </div>
            @if (downloads.supported) {
              <span class="health health--ok">
                <sc-icon name="download" />
                {{ downloads.stats().count }} saved · {{ formatBytes(downloads.stats().totalBytes) }}
              </span>
            } @else {
              <span class="health">Unavailable</span>
            }
          </div>

          @if (activeDownload(); as active) {
            <div class="dl-progress" role="status" aria-live="polite">
              <span>Downloading…</span>
              <div class="dl-progress__bar">
                <span [style.width.%]="active.percent ?? 8"></span>
              </div>
              <span>{{ active.percent == null ? 'starting' : active.percent + '%' }}</span>
            </div>
          }

          @if (!downloads.supported) {
            <p class="card__hint">
              Tracks stream on demand from your Jellyfin server. The rolling cache keeps recent
              audio for reconnects, but it is evictable and never treated as a saved download.
            </p>
          } @else if (downloadedTracks().length > 0) {
            <ul class="dl-list">
              @for (track of downloadedTracks(); track track.id) {
                <li>
                  <span class="dl-list__title">{{ track.title }}</span>
                  <span class="dl-list__artist">{{ track.artist }}</span>
                  <button
                    type="button"
                    class="icon-btn icon-btn--danger"
                    [attr.aria-label]="'Remove download for ' + track.title"
                    title="Remove download"
                    (click)="downloads.remove(track.id, track.title)"
                  >
                    <sc-icon name="trash" />
                  </button>
                </li>
              }
            </ul>
          } @else {
            <p class="card__hint">
              Nothing downloaded yet. Use the download action in the Library to pin tracks for
              offline listening.
            </p>
          }
        </section>

        <section class="card card--wide" aria-labelledby="server-heading">
          <div class="card__head">
            <div>
              <h2 id="server-heading">Jellyfin server</h2>
              <p class="card__hint">
                Connect to a Jellyfin server to browse and stream its music library.
              </p>
            </div>
          </div>

          <sc-jellyfin-panel />
        </section>

        <section class="card card--about" aria-labelledby="about-heading">
          <img src="branding/statocyst-icon.png" alt="" class="about__icon" />
          <div>
            <h2 id="about-heading">Statocyst</h2>
            <p class="card__hint">
              @if (isNative()) {
                Local-first, Jellyfin-oriented music for Android. Named after the jellyfish
                orientation organ.
              } @else {
                Local-first, Jellyfin-oriented music for the desktop. Named after the jellyfish
                orientation organ.
              }
            </p>
            <p class="about__version">
              Version {{ info()?.version ?? '—' }}
              @if (info()?.packaged) {
                · packaged build
              } @else {
                · development build
              }
            </p>
          </div>
        </section>
      </div>
    </section>
  `,
  styles: [
    `
      .dl-progress {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 4px 0 14px;
        font-size: 0.82rem;
        color: var(--muted);
      }
      .dl-progress__bar {
        flex: 1;
        height: 6px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.1);
      }
      .dl-progress__bar span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, var(--cyan), var(--violet, #8b7bff));
        transition: width 200ms ease;
      }
      .view {
        display: grid;
        gap: clamp(16px, 2vw, 26px);
        padding: clamp(20px, 3vw, 38px);
        max-width: 1180px;
        margin: 0 auto;
        animation: rise 380ms ease both;
      }
      .view__head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 18px;
        flex-wrap: wrap;
      }
      h1 {
        margin: 4px 0 6px;
        font-size: clamp(2rem, 3.2vw, 2.8rem);
        letter-spacing: -0.03em;
      }
      .lede {
        margin: 0;
        color: var(--muted);
        max-width: 60ch;
        font-size: 0.9rem;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: clamp(12px, 2vw, 20px);
      }
      .card {
        border: 1px solid var(--line);
        background: var(--surface-3);
        border-radius: var(--radius);
        padding: clamp(16px, 2vw, 24px);
        display: grid;
        gap: 14px;
        align-content: start;
      }
      .card--wide {
        grid-column: 1 / -1;
      }
      .card--about {
        grid-column: 1 / -1;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 20px;
      }
      .card h2 {
        margin: 0;
        font-size: 1.08rem;
        letter-spacing: 0.01em;
      }
      .card__hint {
        margin: 0;
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.55;
      }
      .card__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }
      .card__actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 4px;
      }
      .field {
        display: grid;
        gap: 8px;
      }
      .field__label {
        font-size: 0.72rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .segmented {
        display: inline-flex;
        padding: 3px;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: var(--surface-1);
        width: fit-content;
        flex-wrap: wrap;
      }
      .segmented button {
        border: 0;
        background: none;
        color: var(--muted);
        font: inherit;
        font-size: 0.8rem;
        padding: 7px 15px;
        border-radius: 9px;
        cursor: pointer;
        transition: background 140ms ease, color 140ms ease;
      }
      .segmented button:hover {
        color: var(--text);
      }
      .segmented button.is-active {
        background: linear-gradient(140deg, rgba(56, 225, 255, 0.24), rgba(167, 139, 250, 0.24));
        color: var(--text);
        box-shadow: inset 0 0 0 1px rgba(56, 225, 255, 0.3);
      }
      .access-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
        padding: 6px 0;
      }
      .access-row code {
        flex: 1 1 100%;
        overflow-wrap: anywhere;
      }
      .car-steps {
        margin: 12px 0;
        padding-left: 1.25rem;
        display: grid;
        gap: 8px;
        color: var(--muted);
      }
      .shortcuts {
        display: grid;
        gap: 8px;
        margin: 0;
      }
      .shortcuts div {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-size: 0.82rem;
        border-bottom: 1px dashed rgba(148, 197, 255, 0.1);
        padding-bottom: 7px;
      }
      .shortcuts div:last-child {
        border-bottom: 0;
        padding-bottom: 0;
      }
      .shortcuts dt {
        display: flex;
        gap: 4px;
      }
      .shortcuts dd {
        margin: 0;
        color: var(--muted);
      }
      kbd {
        font-family: var(--mono);
        font-size: 0.68rem;
        padding: 2px 7px;
        border-radius: 6px;
        border: 1px solid var(--line);
        background: rgba(148, 197, 255, 0.08);
        color: var(--text);
      }
      .health {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 0.72rem;
        padding: 5px 11px;
        border-radius: 999px;
        border: 1px solid var(--line);
        color: var(--muted);
      }
      .health--ok {
        color: var(--success);
        border-color: rgba(74, 222, 128, 0.35);
        background: rgba(74, 222, 128, 0.08);
      }
      .health--bad {
        color: var(--danger);
        border-color: rgba(255, 107, 138, 0.4);
      }
      .facts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px 18px;
        margin: 0;
      }
      .facts div {
        display: grid;
        gap: 2px;
        padding: 8px 0;
        border-bottom: 1px dashed rgba(148, 197, 255, 0.08);
      }
      .facts dt {
        font-size: 0.64rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .facts dd {
        margin: 0;
        font-size: 0.84rem;
        font-variant-numeric: tabular-nums;
      }
      .facts .path {
        font-family: var(--mono);
        font-size: 0.72rem;
        color: var(--muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        direction: rtl;
        text-align: left;
      }
      .section-label {
        margin: 18px 0 8px;
        font-size: 0.64rem;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .checks {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .check {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 9px 12px;
        border-radius: 11px;
        border: 1px solid var(--line);
        background: var(--surface-1);
        font-size: 0.78rem;
      }
      .check sc-icon {
        margin-top: 1px;
        color: var(--muted);
      }
      .check__body {
        display: grid;
        gap: 1px;
        min-width: 0;
      }
      .check__body span {
        color: var(--muted);
      }
      .check[data-status='ok'] sc-icon {
        color: var(--success);
      }
      .check[data-status='warn'] sc-icon {
        color: var(--warning);
      }
      .check[data-status='fail'] {
        border-color: rgba(255, 107, 138, 0.34);
      }
      .check[data-status='fail'] sc-icon {
        color: var(--danger);
      }
      .toggle-row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: var(--surface-1);
        cursor: pointer;
        min-height: 44px;
        box-sizing: border-box;
      }
      .toggle-row input {
        width: 20px;
        height: 20px;
        margin: 1px 0 0;
        accent-color: var(--cyan);
        flex: none;
      }
      .toggle-row__text {
        display: grid;
        gap: 2px;
        font-size: 0.82rem;
      }
      .toggle-row__text span {
        color: var(--muted);
        font-size: 0.76rem;
      }
      .about__icon {
        width: 84px;
        height: 84px;
        border-radius: 20px;
        border: 1px solid var(--line);
      }
      .about__version {
        margin: 4px 0 0;
        font-size: 0.74rem;
        color: var(--muted);
        letter-spacing: 0.04em;
      }
      .dl-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
      }
      .dl-list li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 12px;
        padding: 9px 0;
        border-bottom: 1px dashed rgba(148, 197, 255, 0.1);
      }
      .dl-list li:last-child {
        border-bottom: 0;
      }
      .dl-list__title {
        font-weight: 600;
        font-size: 0.86rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dl-list__artist {
        color: var(--muted);
        font-size: 0.76rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
      @media (max-width: 860px) {
        .grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class SettingsViewComponent {
  protected readonly settings = inject(SettingsStore);
  protected readonly isNative = isNativePlatform;
  protected readonly downloads = inject(DownloadsStore);
  private readonly library = inject(LibraryStore);

  /** In-flight download, if any, with a rounded percentage when the size is known. */
  protected readonly activeDownload = computed(() => {
    const current = this.downloads.progress();
    if (!current || current.done) return null;
    const percent = current.totalBytes
      ? Math.min(100, Math.round((current.receivedBytes / current.totalBytes) * 100))
      : null;
    return { trackId: current.trackId, percent };
  });
  private readonly toasts = inject(ToastStore);

  protected readonly info = signal<AppInfo | null>(null);
  protected readonly diagnostics = signal<DiagnosticsInfo | null>(null);
  protected readonly cacheStats = signal<CacheStats | null>(null);
  protected readonly health = signal<HealthCheck[]>([]);
  protected readonly formatBytes = formatBytes;

  protected readonly downloadedTracks = computed(() => {
    const ids = this.downloads.downloadedIds();
    return this.library.tracks().filter((track) => ids.has(track.id));
  });

  protected readonly themes: Array<{ value: ThemePreference; label: string }> = [
    { value: 'system', label: 'System' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ];
  protected readonly densities: Array<{ value: DensityPreference; label: string }> = [
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'compact', label: 'Compact' },
  ];
  protected readonly qualities: Array<{ value: QualityPreference; label: string }> = [
    { value: 'lossless', label: 'Lossless first' },
    { value: 'auto', label: 'Adaptive' },
  ];
  protected readonly budgets: Array<{ value: number; label: string }> = [
    { value: 512 * 1024 * 1024, label: '512 MB' },
    { value: 2 * 1024 * 1024 * 1024, label: '2 GB' },
    { value: 8 * 1024 * 1024 * 1024, label: '8 GB' },
    { value: 32 * 1024 * 1024 * 1024, label: '32 GB' },
  ];

  protected readonly isPackaged = computed(() => this.info()?.packaged ?? false);

  protected readonly externalArtwork = signal<boolean | null>(null);
  protected readonly browseAccess = signal<{ allowed: string[]; denied: string[] } | null>(null);

  constructor() {
    void this.refresh();
    void this.refreshBrowseAccess();
    void this.refreshExternalArtwork();
  }

  protected async refreshExternalArtwork(): Promise<void> {
    if (!isNativePlatform()) return;
    try {
      const api = bridge();
      if (api.getExternalArtwork) this.externalArtwork.set((await api.getExternalArtwork()).enabled);
    } catch {
      this.externalArtwork.set(null);
    }
  }

  protected async setExternalArtwork(event: Event): Promise<void> {
    const api = bridge();
    if (!api.setExternalArtwork) return;
    const enabled = (event.target as HTMLInputElement | null)?.checked ?? false;
    this.externalArtwork.set((await api.setExternalArtwork({ enabled })).enabled);
    await this.library.refresh();
  }

  protected async refreshBrowseAccess(): Promise<void> {
    if (!isNativePlatform()) return;
    try {
      const api = bridge();
      if (api.getBrowseAccess) this.browseAccess.set(await api.getBrowseAccess());
    } catch {
      this.browseAccess.set(null);
    }
  }

  protected async setBrowseAllowed(packageName: string, allowed: boolean): Promise<void> {
    const api = bridge();
    if (!api.setBrowseAllowed) return;
    this.browseAccess.set(await api.setBrowseAllowed({ packageName, allowed }));
  }

  protected async refresh(): Promise<void> {
    try {
      const [info, diagnostics, health] = await Promise.all([
        bridge().app.info(),
        bridge().app.diagnostics(),
        bridge().app.health().catch(() => [] as HealthCheck[]),
      ]);
      this.info.set(info);
      this.diagnostics.set(diagnostics);
      this.health.set(health);
    } catch (error) {
      this.toasts.error('Diagnostics unavailable', String(error));
    }
    await this.refreshCache();
  }

  protected async refreshCache(): Promise<void> {
    try {
      this.cacheStats.set(await bridge().cache.stats());
    } catch {
      // Cache stats are informational; the panel stays in its empty state.
    }
  }

  protected setQuality(quality: QualityPreference): void {
    void this.settings.update({ quality } satisfies Partial<Settings>);
  }

  protected setListeningHistory(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    void this.settings.update({ listeningHistory: target?.checked ?? false });
  }

  protected async exportBundle(): Promise<void> {
    try {
      const result = await bridge().app.exportSupportBundle();
      if (!result.ok) {
        this.toasts.error(result.error.message, result.error.code);
        return;
      }
      if (!result.value.path) return;
      this.toasts.success('Support bundle exported', result.value.path);
    } catch (error) {
      this.toasts.error('Could not export the support bundle', String(error));
    }
  }

  protected setCacheBudget(cacheBudgetBytes: number): void {
    void this.settings.update({ cacheBudgetBytes } satisfies Partial<Settings>);
    void this.refreshCache();
  }

  protected async clearCache(): Promise<void> {
    if (!window.confirm('Clear the rolling cache? Pinned downloads are not affected.')) return;
    try {
      const result = await bridge().cache.clear();
      if (!result.ok) {
        this.toasts.error(result.error.message, result.error.code);
        return;
      }
      const removed = result.value.removed;
      this.toasts.success(
        'Cache cleared',
        `${removed} cached ${removed === 1 ? 'track' : 'tracks'} removed`,
      );
      await this.refreshCache();
    } catch (error) {
      this.toasts.error('Could not clear the cache', String(error));
    }
  }

  protected async reconcileCache(): Promise<void> {
    try {
      const result = await bridge().cache.reconcile();
      if (!result.ok) {
        this.toasts.error(result.error.message, result.error.code);
        return;
      }
      const { removedEntries, removedOrphans } = result.value;
      this.toasts.success(
        'Cache checked',
        `${removedEntries} stale ${removedEntries === 1 ? 'entry' : 'entries'}, ` +
          `${removedOrphans} orphan ${removedOrphans === 1 ? 'file' : 'files'} removed`,
      );
      await this.refreshCache();
    } catch (error) {
      this.toasts.error('Could not check the cache', String(error));
    }
  }

  protected setTheme(theme: ThemePreference): void {
    void this.settings.update({ theme } satisfies Partial<Settings>);
  }

  protected setDensity(density: DensityPreference): void {
    void this.settings.update({ density } satisfies Partial<Settings>);
  }

  protected async openDataFolder(): Promise<void> {
    try {
      await bridge().app.openDataFolder();
    } catch (error) {
      this.toasts.error('Could not open the data folder', String(error));
    }
  }

  protected quit(): void {
    if (window.confirm('Quit Statocyst? Playback state is saved first.')) {
      bridge().app.quit();
    }
  }
}
