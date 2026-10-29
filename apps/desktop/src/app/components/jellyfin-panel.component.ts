import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import { IconComponent } from './icon.component';
import { JellyfinStore } from '../core/jellyfin.store';
import { ToastStore } from '../core/toast.store';

/**
 * Single home for all Jellyfin management (add server, sign in, Quick Connect,
 * sync, sign out, remove). Shared by the library empty state and Settings so the
 * two surfaces can never drift.
 */
@Component({
  selector: 'sc-jellyfin-panel',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!jellyfin.encryptionAvailable()) {
      <div class="warn" role="alert">
        <sc-icon name="alert" />
        Secure credential storage is unavailable, so sign-in is disabled.
      </div>
    }

    @if (jellyfin.servers().length === 0) {
      <form class="server-form" (submit)="addServer($event)">
        <label class="field server-form__url">
          <span class="field__label">Server URL</span>
          <input
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
          <p class="server__user">
            @if (server.userName) {
              Signed in as <strong>{{ server.userName }}</strong>
            } @else {
              Signed in with a saved session
            }
          </p>
          <div class="server__actions">
            <button type="button" class="btn" [disabled]="jellyfin.busy()" (click)="sync(server.id)">
              <sc-icon name="refresh" /> Sync library
            </button>
            <button type="button" class="btn btn--quiet" (click)="logout(server.id)">
              <sc-icon name="close" /> Sign out
            </button>
            <button type="button" class="btn btn--danger" (click)="removeServer(server.id)">
              <sc-icon name="trash" /> Remove server
            </button>
          </div>
        } @else {
          <form class="server-form" (submit)="login(server.url, $event)">
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
              [disabled]="
                jellyfin.busy() ||
                !jellyfin.encryptionAvailable() ||
                username().trim().length === 0
              "
            >
              <sc-icon name="check" /> Sign in
            </button>
            <button type="button" class="btn btn--quiet" (click)="removeServer(server.id)">
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
              class="btn btn--primary"
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
      <p class="panel__hint">Contacting server…</p>
    }
  `,
  styles: [
    `
      :host {
        display: grid;
        gap: 12px;
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
      .server-form {
        display: flex;
        align-items: flex-end;
        gap: 12px;
        flex-wrap: wrap;
      }
      .server-form .field {
        flex: 1;
        min-width: 160px;
      }
      .server-form__url {
        min-width: 220px;
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
      .server__actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .health {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.7rem;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        color: var(--muted);
      }
      .health--ok {
        color: var(--success);
        border-color: rgba(74, 222, 128, 0.35);
        background: rgba(74, 222, 128, 0.08);
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
        margin-top: 4px;
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
      .panel__hint {
        margin: 0;
        color: var(--muted);
        font-size: 0.82rem;
      }
    `,
  ],
})
export class JellyfinPanelComponent implements OnDestroy {
  protected readonly jellyfin = inject(JellyfinStore);
  private readonly toasts = inject(ToastStore);

  protected readonly serverUrl = signal('');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly quickConnectCode = signal<string | null>(null);
  protected readonly quickConnectSecret = signal<string | null>(null);
  private quickConnectTimer: ReturnType<typeof setInterval> | null = null;

  protected async addServer(event: Event): Promise<void> {
    event.preventDefault();
    const url = this.serverUrl().trim();
    if (!url) return;
    await this.jellyfin.addServer(url);
    this.serverUrl.set('');
  }

  protected async login(url: string, event: Event): Promise<void> {
    event.preventDefault();
    await this.jellyfin.login(url, this.username().trim(), this.password());
    this.username.set('');
    this.password.set('');
  }

  protected async sync(serverId: string): Promise<void> {
    await this.jellyfin.sync(serverId);
  }

  protected async logout(serverId: string): Promise<void> {
    await this.jellyfin.logout(serverId);
  }

  protected async removeServer(serverId: string): Promise<void> {
    await this.jellyfin.removeServer(serverId);
  }

  protected async startQuickConnect(url: string): Promise<void> {
    try {
      const result = await this.jellyfin.initiateQuickConnect(url);
      if (!result.ok) {
        this.toasts.error('Quick Connect unavailable', result.error.message);
        return;
      }
      this.quickConnectSecret.set(result.value.secret);
      this.quickConnectCode.set(result.value.code);
      this.startQuickConnectPolling(url, result.value.secret);
    } catch (error) {
      this.toasts.error('Quick Connect failed', String(error));
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
  }

  ngOnDestroy(): void {
    this.cancelQuickConnect();
  }
}
