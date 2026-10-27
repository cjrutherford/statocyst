import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import type { AppInfo, DiagnosticsInfo, DensityPreference, Settings, ThemePreference } from '@statocyst/contracts';
import { IconComponent } from '../components/icon.component';
import { bridge } from '../core/bridge';
import { JellyfinStore } from '../core/jellyfin.store';
import { SettingsStore } from '../core/settings.store';
import { ToastStore } from '../core/toast.store';
import { formatBytes } from '../core/format';

@Component({
  selector: 'sc-settings-view',
  standalone: true,
  imports: [IconComponent],
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
          <p class="card__hint">The shell follows your desktop theme by default.</p>

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
        </section>

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

        <section class="card card--wide" aria-labelledby="diagnostics-heading">
          <div class="card__head">
            <div>
              <h2 id="diagnostics-heading">Local data and diagnostics</h2>
              <p class="card__hint">
                Everything below is stored on this machine. Statocyst makes no network request for
                local playback.
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
              <div>
                <dt>Log file</dt>
                <dd class="path" [title]="data.logPath">{{ data.logPath }}</dd>
              </div>
              <div><dt>Database size</dt><dd>{{ formatBytes(data.databaseBytes) }}</dd></div>
              <div><dt>Schema version</dt><dd>{{ data.schemaVersion }}</dd></div>
              <div><dt>Queue entries</dt><dd>{{ data.queueEntries }}</dd></div>
              <div><dt>Catalogued tracks</dt><dd>{{ data.trackCount }}</dd></div>
              @if (info(); as app) {
                <div><dt>Electron</dt><dd>{{ app.electron }}</dd></div>
                <div><dt>Chromium</dt><dd>{{ app.chrome }}</dd></div>
                <div><dt>Node</dt><dd>{{ app.node }}</dd></div>
                <div><dt>Platform</dt><dd>{{ app.platform }}</dd></div>
              }
            </dl>
          } @else {
            <p class="card__hint">Reading diagnostics…</p>
          }

          <div class="card__actions">
            <button type="button" class="btn" (click)="openDataFolder()">
              <sc-icon name="folder" /> Open data folder
            </button>
            <button type="button" class="btn btn--danger" (click)="quit()">
              <sc-icon name="close" /> Quit Statocyst
            </button>
          </div>
        </section>

        <section class="card card--wide" aria-labelledby="server-heading">
          <div class="card__head">
            <div>
              <h2 id="server-heading">Jellyfin server</h2>
              <p class="card__hint">
                Connect to a Jellyfin server to browse and stream its music library. Credentials are
                encrypted with your system keychain and never stored in plaintext.
              </p>
            </div>
          </div>

          @if (!jellyfin.encryptionAvailable()) {
            <div class="warn" role="alert">
              <sc-icon name="alert" />
              Secure credential storage is unavailable, so sign-in is disabled.
            </div>
          }

          @if (jellyfin.servers().length === 0) {
            <form class="server-form" (submit)="addServer()">
              <label class="field server-form__url">
                <span class="field__label" id="server-url-label">Server URL</span>
                <input
                  id="server-url"
                  type="url"
                  placeholder="https://jellyfin.example.com"
                  [value]="serverUrl()"
                  (input)="serverUrl.set($any($event.target).value)"
                />
              </label>
              <button
                type="submit"
                class="btn btn--primary"
                [disabled]="jellyfin.busy() || serverUrl().trim().length === 0"
              >
                <sc-icon name="external" /> Connect
              </button>
            </form>
          }

          @for (server of jellyfin.servers(); track server.id) {
            <div class="server">
              <div class="server__head">
                <div class="server__id">
                  <span class="server__name">{{ server.name }}</span>
                  <span class="server__url" [title]="server.url">{{ server.url }}</span>
                  @if (server.version) {
                    <span class="server__version">Jellyfin {{ server.version }}</span>
                  }
                </div>
                @if (server.connected) {
                  <span class="health health--ok"><sc-icon name="check" /> Connected</span>
                } @else {
                  <span class="health">Not signed in</span>
                }
              </div>

              @if (server.connected) {
                <p class="server__user">Signed in as <strong>{{ server.userName }}</strong></p>
                <div class="card__actions">
                  <button
                    type="button"
                    class="btn"
                    [disabled]="jellyfin.busy()"
                    (click)="jellyfin.sync(server.id)"
                  >
                    <sc-icon name="refresh" /> Sync library
                  </button>
                  <button type="button" class="btn btn--quiet" (click)="jellyfin.logout(server.id)">
                    <sc-icon name="close" /> Sign out
                  </button>
                  <button type="button" class="btn btn--danger" (click)="jellyfin.removeServer(server.id)">
                    <sc-icon name="trash" /> Remove server
                  </button>
                </div>
              } @else {
                <form class="server-form" (submit)="login(server.url)">
                  <label class="field">
                    <span class="field__label">Username</span>
                    <input
                      type="text"
                      autocomplete="username"
                      [value]="username()"
                      (input)="username.set($any($event.target).value)"
                    />
                  </label>
                  <label class="field">
                    <span class="field__label">Password</span>
                    <input
                      type="password"
                      autocomplete="current-password"
                      [value]="password()"
                      (input)="password.set($any($event.target).value)"
                    />
                  </label>
                  <button
                    type="submit"
                    class="btn btn--primary"
                    [disabled]="jellyfin.busy() || !jellyfin.encryptionAvailable() || username().trim().length === 0 || password().length === 0"
                  >
                    <sc-icon name="check" /> Sign in
                  </button>
                  <button type="button" class="btn btn--quiet" (click)="jellyfin.removeServer(server.id)">
                    Remove
                  </button>
                </form>

                @if (quickConnectCode()) {
                  <div class="quick-connect" role="status" aria-live="polite">
                    <span class="quick-connect__label">Enter this code in your Jellyfin web UI:</span>
                    <span class="quick-connect__code">{{ quickConnectCode() }}</span>
                    <span class="quick-connect__hint">Waiting for approval…</span>
                    <button type="button" class="btn btn--quiet" (click)="cancelQuickConnect()">
                      Cancel
                    </button>
                  </div>
                } @else {
                  <button
                    type="button"
                    class="btn btn--quiet"
                    [disabled]="jellyfin.busy() || !jellyfin.encryptionAvailable()"
                    (click)="startQuickConnect(server.url)"
                  >
                    <sc-icon name="external" /> Sign in with Quick Connect
                  </button>
                }
              }
            </div>
          }

          @if (jellyfin.busy()) {
            <p class="card__hint">Contacting server…</p>
          }
        </section>

        <section class="card card--about" aria-labelledby="about-heading">
          <img src="branding/statocyst-icon.png" alt="" class="about__icon" />
          <div>
            <h2 id="about-heading">Statocyst</h2>
            <p class="card__hint">
              Local-first, Jellyfin-oriented music for the desktop. Named after the jellyfish
              orientation organ.
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
      .warn {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.8rem;
        color: var(--danger);
        border: 1px solid rgba(255, 107, 138, 0.35);
        background: rgba(255, 107, 138, 0.08);
        border-radius: 10px;
        padding: 9px 12px;
      }
      .quick-connect {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        border: 1px solid rgba(56, 225, 255, 0.22);
        background: rgba(56, 225, 255, 0.05);
        border-radius: 12px;
        padding: 12px 16px;
      }
      .quick-connect__label {
        color: var(--muted);
        font-size: 0.8rem;
      }
      .quick-connect__code {
        font-family: var(--mono);
        font-size: 1.4rem;
        font-weight: 600;
        letter-spacing: 0.18em;
        color: var(--text);
      }
      .quick-connect__hint {
        color: var(--muted);
        font-size: 0.76rem;
      }
      .server-form {
        display: flex;
        align-items: flex-end;
        gap: 12px;
        flex-wrap: wrap;
      }
      .server-form .field {
        flex: 1;
        min-width: 180px;
      }
      .server-form input {
        background: var(--surface-1);
        color: var(--text);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 9px 12px;
        font: inherit;
        font-size: 0.86rem;
        width: 100%;
        box-sizing: border-box;
      }
      .server-form input:focus {
        outline: none;
        border-color: rgba(56, 225, 255, 0.5);
        box-shadow: 0 0 0 3px rgba(56, 225, 255, 0.12);
      }
      .server {
        display: grid;
        gap: 10px;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 14px 16px;
        background: var(--surface-2);
      }
      .server__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
      }
      .server__id {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .server__name {
        font-weight: 600;
        font-size: 0.95rem;
      }
      .server__url {
        color: var(--muted);
        font-family: var(--mono);
        font-size: 0.72rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        direction: rtl;
        text-align: left;
      }
      .server__version {
        color: var(--muted);
        font-size: 0.68rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .server__user {
        margin: 0;
        color: var(--muted);
        font-size: 0.84rem;
      }
      .server__user strong {
        color: var(--text);
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
      @media (max-width: 860px) {
        .grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class SettingsViewComponent implements OnDestroy {
  protected readonly settings = inject(SettingsStore);
  protected readonly jellyfin = inject(JellyfinStore);
  private readonly toasts = inject(ToastStore);

  protected readonly info = signal<AppInfo | null>(null);
  protected readonly diagnostics = signal<DiagnosticsInfo | null>(null);
  protected readonly formatBytes = formatBytes;

  protected readonly serverUrl = signal('');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly quickConnectCode = signal<string | null>(null);
  protected readonly quickConnectSecret = signal<string | null>(null);
  protected readonly quickConnectWorking = signal(false);
  private quickConnectTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly themes: Array<{ value: ThemePreference; label: string }> = [
    { value: 'system', label: 'System' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ];
  protected readonly densities: Array<{ value: DensityPreference; label: string }> = [
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'compact', label: 'Compact' },
  ];

  protected readonly isPackaged = computed(() => this.info()?.packaged ?? false);

  constructor() {
    void this.refresh();
  }

  protected async refresh(): Promise<void> {
    try {
      const [info, diagnostics] = await Promise.all([
        bridge().app.info(),
        bridge().app.diagnostics(),
      ]);
      this.info.set(info);
      this.diagnostics.set(diagnostics);
    } catch (error) {
      this.toasts.error('Diagnostics unavailable', String(error));
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

  protected async addServer(): Promise<void> {
    const url = this.serverUrl().trim();
    if (!url) return;
    await this.jellyfin.addServer(url);
    this.serverUrl.set('');
  }

  protected async login(url: string): Promise<void> {
    await this.jellyfin.login(url, this.username().trim(), this.password());
    this.username.set('');
    this.password.set('');
  }

  protected async startQuickConnect(url: string): Promise<void> {
    this.quickConnectWorking.set(true);
    try {
      const result = await this.jellyfin.initiateQuickConnect(url);
      if (!result.ok) {
        this.toasts.error('Quick Connect unavailable', result.error.message);
        return;
      }
      this.quickConnectSecret.set(result.value.secret);
      this.quickConnectCode.set(result.value.code);
      this.startQuickConnectPolling(url, result.value.secret);
    } finally {
      this.quickConnectWorking.set(false);
    }
  }

  private startQuickConnectPolling(url: string, secret: string): void {
    if (this.quickConnectTimer) clearInterval(this.quickConnectTimer);
    this.quickConnectTimer = setInterval(async () => {
      const poll = await this.jellyfin.pollQuickConnect(url, secret);
      if (!poll.ok) {
        this.cancelQuickConnect();
        this.toasts.error('Quick Connect failed', poll.error.message);
        return;
      }
      if (poll.value.authenticated) {
        this.cancelQuickConnect();
        await this.jellyfin.loginWithQuickConnect(url, secret);
      }
    }, 3000);
  }

  protected cancelQuickConnect(): void {
    if (this.quickConnectTimer) {
      clearInterval(this.quickConnectTimer);
      this.quickConnectTimer = null;
    }
    this.quickConnectCode.set(null);
    this.quickConnectSecret.set(null);
    this.quickConnectWorking.set(false);
  }

  ngOnDestroy(): void {
    this.cancelQuickConnect();
  }
}
