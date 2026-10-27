import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import type { AppInfo } from '@statocyst/contracts';
import { IconComponent, type IconName } from './components/icon.component';
import { PlayerBarComponent } from './components/player-bar.component';
import { AudioEngineService } from './core/audio-engine.service';
import { bridge, bridgeAvailable } from './core/bridge';
import { LibraryStore } from './core/library.store';
import { PlaybackStore } from './core/playback.store';
import { SettingsStore } from './core/settings.store';
import { ToastStore } from './core/toast.store';
import { LibraryViewComponent } from './views/library-view.component';
import { NowPlayingViewComponent } from './views/now-playing.component';
import { QueueViewComponent } from './views/queue-view.component';
import { SettingsViewComponent } from './views/settings-view.component';

type View = 'library' | 'now' | 'queue' | 'settings';

interface NavItem {
  id: View;
  label: string;
  icon: IconName;
}

@Component({
  selector: 'sc-root',
  standalone: true,
  imports: [
    IconComponent,
    PlayerBarComponent,
    LibraryViewComponent,
    NowPlayingViewComponent,
    QueueViewComponent,
    SettingsViewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main-content">Skip to content</a>

    @if (!bridgeAvailable()) {
      <div class="fatal">
        <img src="branding/statocyst-icon.png" alt="" />
        <h1>Desktop shell required</h1>
        <p>
          Statocyst's renderer must run inside the Electron host. Start it with
          <code>pnpm dev</code> from the repository root.
        </p>
      </div>
    } @else {
      <div class="app">
        <aside class="sidebar" aria-label="Primary">
          <div class="brand">
            <img src="branding/statocyst-symbol.png" alt="" class="brand__mark" />
            <div class="brand__text">
              <span class="brand__name">Statocyst</span>
              <span class="brand__tag">Bathypelagic audio</span>
            </div>
          </div>

          <nav class="nav" aria-label="Views">
            @for (item of nav; track item.id) {
              <button
                type="button"
                class="nav__item"
                [class.is-active]="view() === item.id"
                [attr.aria-current]="view() === item.id ? 'page' : null"
                (click)="view.set(item.id)"
              >
                <sc-icon [name]="item.icon" />
                <span class="nav__label">{{ item.label }}</span>
                @if (item.id === 'library' && library.tracks().length > 0) {
                  <span class="nav__badge">{{ library.tracks().length }}</span>
                }
                @if (item.id === 'queue' && playback.queue().entries.length > 0) {
                  <span class="nav__badge">{{ playback.queue().entries.length }}</span>
                }
              </button>
            }
          </nav>

          <div class="sidebar__foot">
            <div class="status" [attr.data-state]="playback.snapshot().state">
              <span class="status__dot" aria-hidden="true"></span>
              <span class="status__text">{{ statusLabel() }}</span>
            </div>
            <p class="sidebar__hint">Space to play · / to search</p>
            <p class="sidebar__version">
              {{ info()?.version ? 'v' + info()!.version : '—' }}
              @if (info()?.packaged) {
                · packaged
              }
            </p>
          </div>
        </aside>

        <main id="main-content" class="main" tabindex="-1">
          @switch (view()) {
            @case ('library') {
              <sc-library-view />
            }
            @case ('now') {
              <sc-now-playing (openQueue)="view.set('queue')" />
            }
            @case ('queue') {
              <sc-queue-view (openLibrary)="view.set('library')" />
            }
            @case ('settings') {
              <sc-settings-view />
            }
          }
        </main>

        <sc-player-bar
          class="player-slot"
          (openNow)="view.set('now')"
          (openQueue)="view.set('queue')"
        />
      </div>

      @if (!ready()) {
        <div class="boot" role="status" aria-live="polite">
          <div class="boot__orb"></div>
          <p>Opening the deep channel…</p>
        </div>
      }
    }

    <div class="toasts" aria-live="polite" aria-atomic="false">
      @for (toast of toasts.toasts(); track toast.id) {
        <div class="toast" [class]="'toast toast--' + toast.kind" role="status">
          <div class="toast__body">
            <span class="toast__message">{{ toast.message }}</span>
            @if (toast.detail) {
              <span class="toast__detail">{{ toast.detail }}</span>
            }
          </div>
          <button
            type="button"
            class="icon-btn toast__close"
            aria-label="Dismiss notification"
            (click)="toasts.dismiss(toast.id)"
          >
            <sc-icon name="close" />
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .app {
        display: grid;
        grid-template-columns: 236px minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) auto;
        height: 100vh;
        height: 100dvh;
      }
      .sidebar {
        grid-row: 1;
        display: flex;
        flex-direction: column;
        gap: 22px;
        padding: 22px 14px 18px;
        border-right: 1px solid var(--line);
        background: var(--sidebar-bg);
        backdrop-filter: blur(18px);
        min-height: 0;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 0 8px;
      }
      .brand__mark {
        width: 40px;
        height: 40px;
        object-fit: contain;
        filter: drop-shadow(0 0 14px rgba(56, 225, 255, 0.38));
      }
      .brand__text {
        display: grid;
        gap: 1px;
        min-width: 0;
      }
      .brand__name {
        font-size: 1.02rem;
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      .brand__tag {
        font-size: 0.62rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--muted);
        white-space: nowrap;
      }
      .nav {
        display: grid;
        gap: 4px;
      }
      .nav__item {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 10px 12px;
        border-radius: 11px;
        border: 1px solid transparent;
        background: none;
        color: var(--muted);
        font: inherit;
        font-size: 0.86rem;
        cursor: pointer;
        text-align: left;
        transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
      }
      .nav__item:hover {
        color: var(--text);
        background: rgba(148, 197, 255, 0.06);
      }
      .nav__item.is-active {
        color: var(--text);
        background: linear-gradient(100deg, rgba(56, 225, 255, 0.14), rgba(167, 139, 250, 0.08));
        border-color: rgba(56, 225, 255, 0.22);
        box-shadow: inset 0 0 18px rgba(56, 225, 255, 0.05);
      }
      .nav__item.is-active sc-icon {
        color: var(--cyan);
      }
      .nav__label {
        flex: 1;
      }
      .nav__badge {
        font-size: 0.64rem;
        padding: 1px 7px;
        border-radius: 999px;
        background: rgba(148, 197, 255, 0.12);
        color: var(--muted);
        font-variant-numeric: tabular-nums;
      }
      .sidebar__foot {
        margin-top: auto;
        display: grid;
        gap: 7px;
        padding: 0 10px;
      }
      .status {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.68rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .status__dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: rgba(148, 197, 255, 0.4);
      }
      .status[data-state='playing'] .status__dot {
        background: var(--cyan);
        box-shadow: 0 0 10px var(--cyan);
        animation: blink 1.8s ease-in-out infinite;
      }
      .status[data-state='buffering'] .status__dot {
        background: var(--violet);
        box-shadow: 0 0 10px var(--violet);
      }
      .status[data-state='error'] .status__dot {
        background: var(--danger);
        box-shadow: 0 0 10px var(--danger);
      }
      .sidebar__hint,
      .sidebar__version {
        margin: 0;
        font-size: 0.64rem;
        color: var(--muted);
        opacity: 0.75;
      }
      .main {
        grid-column: 2;
        overflow: auto;
        min-height: 0;
        outline: none;
        scroll-behavior: smooth;
      }
      .player-slot {
        grid-column: 1 / -1;
        grid-row: 2;
      }
      .boot {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        gap: 16px;
        justify-items: center;
        background: rgba(3, 7, 16, 0.86);
        backdrop-filter: blur(10px);
        z-index: 60;
        color: var(--muted);
        font-size: 0.82rem;
        letter-spacing: 0.08em;
      }
      .boot__orb {
        width: 54px;
        height: 54px;
        border-radius: 50%;
        border: 1px solid rgba(56, 225, 255, 0.4);
        box-shadow:
          0 0 30px rgba(56, 225, 255, 0.2),
          inset 0 0 20px rgba(56, 225, 255, 0.16);
        animation: pulse 1.6s ease-in-out infinite;
      }
      .fatal {
        display: grid;
        place-items: center;
        align-content: center;
        gap: 12px;
        height: 100vh;
        padding: 30px;
        text-align: center;
      }
      .fatal img {
        width: 88px;
        opacity: 0.8;
      }
      .fatal h1 {
        margin: 0;
        font-size: 1.6rem;
      }
      .fatal p {
        margin: 0;
        color: var(--muted);
        max-width: 52ch;
      }
      .fatal code {
        font-family: var(--mono);
        font-size: 0.82em;
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(148, 197, 255, 0.1);
      }
      .toasts {
        position: fixed;
        bottom: 104px;
        right: 18px;
        display: grid;
        gap: 8px;
        z-index: 100;
        max-width: min(380px, calc(100vw - 36px));
        pointer-events: none;
      }
      .toast {
        pointer-events: auto;
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 11px 12px 11px 14px;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: var(--panel-strong);
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
        animation: toast-in 220ms ease both;
      }
      .toast--success {
        border-color: rgba(74, 222, 128, 0.34);
      }
      .toast--error {
        border-color: rgba(255, 107, 138, 0.42);
      }
      .toast__body {
        display: grid;
        gap: 2px;
        flex: 1;
        min-width: 0;
      }
      .toast__message {
        font-size: 0.82rem;
        font-weight: 600;
      }
      .toast__detail {
        font-size: 0.72rem;
        color: var(--muted);
        overflow-wrap: anywhere;
      }
      .toast__close {
        font-size: 0.8rem;
        opacity: 0.7;
      }
      .skip-link {
        position: fixed;
        top: -60px;
        left: 16px;
        z-index: 200;
        padding: 8px 14px;
        border-radius: 8px;
        background: var(--cyan);
        color: #03121f;
        font-size: 0.8rem;
        font-weight: 600;
        text-decoration: none;
        transition: top 120ms ease;
      }
      .skip-link:focus {
        top: 12px;
      }
      @keyframes pulse {
        0%,
        100% {
          transform: scale(0.94);
          opacity: 0.7;
        }
        50% {
          transform: scale(1.04);
          opacity: 1;
        }
      }
      @keyframes blink {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.45;
        }
      }
      @keyframes toast-in {
        from {
          opacity: 0;
          transform: translateY(-6px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @media (max-width: 1080px) {
        .app {
          grid-template-columns: 76px minmax(0, 1fr);
        }
        .brand__text,
        .nav__label,
        .sidebar__foot,
        .nav__badge {
          display: none;
        }
        .brand {
          justify-content: center;
          padding: 0;
        }
        .nav__item {
          justify-content: center;
          padding: 12px;
          font-size: 1rem;
        }
      }
      @media (max-width: 720px) {
        .app {
          grid-template-columns: 1fr;
        }
        .sidebar {
          grid-row: auto;
          flex-direction: row;
          align-items: center;
          padding: 10px 12px;
          border-right: 0;
          border-bottom: 1px solid var(--line);
        }
        .brand__mark {
          width: 32px;
          height: 32px;
        }
        .nav {
          display: flex;
          margin-left: auto;
        }
        .main {
          grid-column: 1;
        }
        .player-slot {
          grid-column: 1;
        }
      }
    `,
  ],
})
export class AppComponent {
  protected readonly library = inject(LibraryStore);
  protected readonly playback = inject(PlaybackStore);
  protected readonly settingsStore = inject(SettingsStore);
  protected readonly toasts = inject(ToastStore);
  protected readonly bridgeAvailable = bridgeAvailable;
  private readonly audio = inject(AudioEngineService);

  readonly view = signal<View>('library');
  readonly ready = signal(false);
  readonly info = signal<AppInfo | null>(null);

  protected readonly nav: NavItem[] = [
    { id: 'library', label: 'Library', icon: 'library' },
    { id: 'now', label: 'Now playing', icon: 'now' },
    { id: 'queue', label: 'Queue', icon: 'queue' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  constructor() {
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    if (!bridgeAvailable()) return;
    try {
      await this.settingsStore.init();
    } catch {
      // Settings failures are non-fatal; defaults are already applied.
    }
    this.audio.start();
    await this.playback.init();
    await this.library.init();
    try {
      this.info.set(await bridge().app.info());
    } catch {
      // Informational only.
    }
    this.ready.set(true);
  }

  protected statusLabel(): string {
    const state = this.playback.snapshot().state;
    switch (state) {
      case 'playing':
        return 'Playing';
      case 'buffering':
        return 'Buffering';
      case 'paused':
        return 'Paused';
      case 'ended':
        return 'Queue ended';
      case 'error':
        return 'Audio error';
      default:
        return 'Idle';
    }
  }

  @HostListener('window:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
      if (event.key === 'Escape') target.blur();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case ' ':
        event.preventDefault();
        void this.playback.toggle();
        break;
      case 'ArrowRight':
        event.preventDefault();
        void this.playback.seekBy(5000);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        void this.playback.seekBy(-5000);
        break;
      case 'n':
      case 'N':
        void this.playback.next();
        break;
      case 'p':
      case 'P':
        void this.playback.previous();
        break;
      case 'm':
      case 'M':
        void this.playback.toggleMute();
        break;
      case 's':
      case 'S':
        void this.playback.toggleShuffle();
        break;
      case 'r':
      case 'R':
        void this.playback.cycleRepeat();
        break;
      case '/':
        event.preventDefault();
        this.view.set('library');
        setTimeout(() => document.getElementById('library-search')?.focus(), 0);
        break;
    }
  }
}
