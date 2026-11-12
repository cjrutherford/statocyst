import { ChangeDetectionStrategy, Component, computed, HostListener, inject, output, signal } from '@angular/core';
import { ArtworkComponent } from './artwork.component';
import { IconComponent } from './icon.component';
import { PodcastVideoStageComponent } from './podcast-video-stage.component';
import { PlaybackStore } from '../core/playback.store';
import { PodcastPlaybackStore } from '../core/podcast-playback.store';
import { NavigationStore } from '../core/navigation.store';
import { isNativePlatform } from '../core/bridge';
import { formatDuration } from '../core/format';

@Component({
  selector: 'sc-player-bar',
  standalone: true,
  imports: [ArtworkComponent, IconComponent, PodcastVideoStageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="player"
      [class.is-dragging]="dragOffset() < 0"
      [style.transform]="dragOffset() ? 'translateY(' + dragOffset() + 'px)' : null"
      (pointerdown)="onDragStart($event)"
      (pointermove)="onDragMove($event)"
      (pointerup)="onDragEnd($event)"
      (pointercancel)="onDragCancel()"
    >
      <div class="player__hairline" aria-hidden="true">
        <span [style.width.%]="progressPercent()"></span>
      </div>
      <span class="player__grab" aria-hidden="true"></span>
      <button
        type="button"
        class="player__track"
        (click)="onTrackActivate()"
        [attr.aria-label]="
          track() ? 'Open now playing: ' + track()!.title : 'No track selected'
        "
      >
        <span class="player__art">
          <sc-artwork [track]="track()" size="md" />
          @if (native && isVideo() && videoPresentation() === 'video' && navigation.view() !== 'now') {
            <sc-podcast-video-stage class="player__video" [compact]="true" />
          }
        </span>
        <span class="player__meta">
          <span class="player__title">{{ track()?.title ?? 'Nothing playing yet' }}</span>
          <span class="player__artist">
            {{ track()?.artist ?? (podcastMode() ? 'Pick an episode' : 'Pick a track from your library') }}
          </span>
          @if (podcastMode()) {
            <span class="player__podcast-tag">{{ isVideo() ? 'Video' : 'Podcast' }} · {{ rate() }}×</span>
          }
        </span>
        @if (state() === 'buffering') {
          <span class="player__state">Buffering</span>
        }
        @if (state() === 'waiting-network') {
          <span class="player__state player__state--waiting">Reconnecting…</span>
        }
        @if (state() === 'error') {
          <span class="player__state player__state--error">Playback error</span>
        }
        <sc-icon name="up" class="player__expand" />
      </button>

      <div class="player__transport">
        <div class="player__controls">
          @if (podcastMode()) {
            <button
              type="button"
              class="icon-btn player__aux"
              aria-label="Skip back 15 seconds"
              title="Skip back 15 seconds"
              (click)="skip(-15000)"
            >
              <span class="player__skip">15</span>
            </button>
          } @else {
            <button
              type="button"
              class="icon-btn player__aux"
              [class.is-active]="playback.snapshot().shuffle"
              [attr.aria-pressed]="playback.snapshot().shuffle"
              aria-label="Shuffle queue"
              title="Shuffle (S)"
              (click)="playback.toggleShuffle()"
            >
              <sc-icon name="shuffle" />
            </button>
          }
          <button
            type="button"
            class="icon-btn"
            aria-label="Previous track"
            [disabled]="idle()"
            title="Previous (P)"
            (click)="previous()"
          >
            <sc-icon name="previous" />
          </button>
          <button
            type="button"
            class="player__play"
            [class.is-live]="isPlaying()"
            [class.is-pulsing]="pulsing()"
            [attr.aria-label]="isPlaying() ? 'Pause' : 'Play'"
            title="Play or pause (Space)"
            [disabled]="idle()"
            (click)="togglePlay()"
          >
            <sc-icon [name]="isPlaying() ? 'pause' : 'play'" />
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label="Next track"
            [disabled]="idle()"
            title="Next (N)"
            (click)="next()"
          >
            <sc-icon name="next" />
          </button>
          @if (podcastMode()) {
            <button
              type="button"
              class="icon-btn player__aux"
              aria-label="Skip forward 30 seconds"
              title="Skip forward 30 seconds"
              (click)="skip(30000)"
            >
              <span class="player__skip">30</span>
            </button>
            <button
              type="button"
              class="player__rate"
              [attr.aria-label]="'Playback speed ' + rate() + ' times'"
              [title]="'Playback speed: ' + rate() + '×'"
              (click)="cycleRate()"
            >
              {{ rate() }}×
            </button>
          } @else {
            <button
              type="button"
              class="icon-btn player__aux"
              [class.is-active]="playback.snapshot().repeat !== 'off'"
              [attr.aria-label]="'Repeat ' + playback.snapshot().repeat"
              [title]="'Repeat (R): ' + playback.snapshot().repeat"
              (click)="playback.cycleRepeat()"
            >
              <sc-icon [name]="playback.snapshot().repeat === 'one' ? 'repeat-one' : 'repeat'" />
            </button>
          }
        </div>

        <div class="player__seek">
          <span class="player__time">{{ formatDuration(displayPosition()) }}</span>
          <input
            class="range range--seek"
            type="range"
            min="0"
            [max]="displayDuration()"
            step="250"
            [value]="displayPosition()"
            [style.--progress]="progressPercent() + '%'"
            [disabled]="!track()"
            aria-label="Seek position"
            (input)="onSeekInput($event)"
            (change)="onSeekCommit($event)"
          />
          <span class="player__time">{{ formatDuration(displayDuration()) }}</span>
        </div>
      </div>

      <div class="player__extras">
        <button
          type="button"
          class="icon-btn"
          [class.is-active]="volumeOpen()"
          [attr.aria-label]="playback.snapshot().muted ? 'Volume (muted)' : 'Volume'"
          [attr.aria-expanded]="volumeOpen()"
          aria-haspopup="dialog"
          [title]="'Volume (M to mute)'"
          (click)="volumeOpen.set(!volumeOpen())"
        >
          <sc-icon [name]="playback.snapshot().muted ? 'mute' : 'volume'" />
        </button>
        @if (volumeOpen()) {
          <div class="volume-backdrop" (click)="volumeOpen.set(false)"></div>
          <div class="volume-pop" role="dialog" aria-label="Volume">
            <button
              type="button"
              class="icon-btn"
              [attr.aria-label]="playback.snapshot().muted ? 'Unmute' : 'Mute'"
              (click)="playback.toggleMute()"
            >
              <sc-icon [name]="playback.snapshot().muted ? 'mute' : 'volume'" />
            </button>
            <input
              class="range range--volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              [value]="playback.snapshot().volume"
              [style.--progress]="volumePercent() + '%'"
              aria-label="Volume"
              (input)="onVolume($event)"
            />
            <span class="volume-value">{{ volumePercent().toFixed(0) }}%</span>
          </div>
        }
        <button
          type="button"
          class="icon-btn"
          aria-label="Open queue"
          title="Queue"
          (click)="openQueue.emit()"
        >
          <sc-icon name="queue" />
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .player {
        display: grid;
        grid-template-columns: minmax(180px, 1fr) minmax(320px, 1.5fr) minmax(160px, 1fr);
        align-items: center;
        gap: clamp(12px, 2vw, 28px);
        padding: 12px clamp(14px, 2vw, 26px);
        background: linear-gradient(
          180deg,
          var(--chrome-top),
          var(--chrome-bottom)
        );
        border-top: 1px solid var(--line);
        backdrop-filter: blur(22px);
        box-shadow: var(--chrome-shadow);
        touch-action: none;
        user-select: none;
        transition: transform 160ms ease;
      }
      .player__grab {
        position: absolute;
        top: 5px;
        left: 50%;
        width: 42px;
        height: 4px;
        margin-left: -21px;
        border-radius: 999px;
        background: var(--line-strong);
        opacity: 0.65;
      }
      .player.is-dragging {
        transition: none;
      }
      .player__art {
        position: relative;
        display: inline-grid;
        flex: 0 0 auto;
        width: 60px;
        height: 60px;
      }
      .player__video {
        position: absolute;
        inset: 0;
        width: 60px;
        height: 60px;
        border-radius: 12px;
        overflow: hidden;
      }
      .player__track {
        display: flex;
        align-items: center;
        gap: 12px;
        background: none;
        border: 0;
        padding: 4px;
        border-radius: 14px;
        color: inherit;
        text-align: left;
        cursor: pointer;
        min-width: 0;
      }
      .player__track:disabled {
        cursor: default;
      }
      .player__track:not(:disabled):hover {
        background: rgba(56, 225, 255, 0.06);
      }
      .player__meta {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .player__title {
        font-weight: 600;
        font-size: 0.92rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .player__artist {
        color: var(--muted);
        font-size: 0.78rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .player__podcast-tag {
        color: var(--cyan);
        font-size: 0.66rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .player__skip {
        font-size: 0.62rem;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      .player__rate {
        min-width: 44px;
        padding: 3px 7px;
        border-radius: 999px;
        border: 1px solid var(--line-strong);
        background: var(--surface-1);
        color: var(--cyan);
        font: inherit;
        font-size: 0.68rem;
        cursor: pointer;
      }
      .player__rate:hover {
        border-color: var(--cyan);
      }
      .player__state {
        margin-left: auto;
        font-size: 0.64rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--cyan);
      }
      .player__state--error {
        color: var(--danger);
      }
      .player__state--waiting {
        color: var(--warning);
      }
      .player__expand {
        margin-left: auto;
        color: var(--muted);
        opacity: 0.7;
        font-size: 0.9em;
      }
      .player__transport {
        display: grid;
        gap: 6px;
      }
      .player__controls {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: clamp(6px, 1.2vw, 14px);
      }
      .player__play:disabled {
        opacity: 0.45;
        box-shadow: none;
        cursor: default;
      }
      .player__play {
        position: relative;
        width: 46px;
        height: 46px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        border: 1px solid rgba(56, 225, 255, 0.55);
        background:
          radial-gradient(circle at 32% 26%, rgba(255, 255, 255, 0.34), transparent 48%),
          linear-gradient(160deg, #4ce7ff, #1f9fd8 55%, #7466f5);
        color: #03121f;
        font-size: 1.25rem;
        cursor: pointer;
        box-shadow:
          0 0 22px rgba(56, 225, 255, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.4);
        transition: transform 120ms ease, box-shadow 160ms ease;
      }
      .player__play:hover {
        transform: translateY(-1px) scale(1.03);
        box-shadow: 0 0 34px rgba(56, 225, 255, 0.52);
      }
      .player__play:active {
        transform: scale(0.96);
      }
      .player__play.is-live {
        animation: play-pulse 2.8s ease-in-out infinite;
      }
      .player__play::before,
      .player__play::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 1px solid rgba(56, 225, 255, 0.55);
        opacity: 0;
        pointer-events: none;
      }
      .player__play.is-pulsing::before {
        animation: player-sonar 900ms var(--ease-tide) both;
      }
      .player__play.is-pulsing::after {
        animation: player-sonar 900ms var(--ease-tide) 160ms both;
      }
      @keyframes player-sonar {
        0% {
          opacity: 0.7;
          transform: scale(0.9);
        }
        100% {
          opacity: 0;
          transform: scale(2.2);
        }
      }
      @keyframes play-pulse {
        0%,
        100% {
          box-shadow: 0 0 22px rgba(56, 225, 255, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.4);
        }
        50% {
          box-shadow: 0 0 38px rgba(56, 225, 255, 0.56), inset 0 1px 0 rgba(255, 255, 255, 0.4);
        }
      }
      .player__seek {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .player__time {
        font-variant-numeric: tabular-nums;
        font-size: 0.7rem;
        color: var(--muted);
        min-width: 34px;
        text-align: center;
      }
      .player__extras {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }
      .volume-backdrop {
        position: fixed;
        inset: 0;
        z-index: 119;
      }
      .volume-pop {
        position: fixed;
        right: 24px;
        bottom: 134px;
        z-index: 120;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--panel-strong, #0b1224);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.42);
        backdrop-filter: blur(18px);
      }
      .volume-pop .range--volume {
        width: 110px;
      }
      .volume-value {
        min-width: 34px;
        text-align: right;
        font-size: 0.7rem;
        color: var(--muted);
        font-variant-numeric: tabular-nums;
      }
      .range {
        appearance: none;
        height: 18px;
        background: transparent;
        cursor: pointer;
      }
      .range--seek {
        flex: 1;
        min-width: 80px;
      }
      .range--volume {
        width: 88px;
      }
      .range::-webkit-slider-runnable-track {
        height: 4px;
        border-radius: 999px;
        background: linear-gradient(
          90deg,
          var(--cyan) 0%,
          var(--violet) var(--progress, 0%),
          rgba(148, 197, 255, 0.18) var(--progress, 0%)
        );
      }
      .range::-webkit-slider-thumb {
        appearance: none;
        width: 12px;
        height: 12px;
        margin-top: -4px;
        border-radius: 50%;
        background: var(--pearl);
        border: 1px solid rgba(56, 225, 255, 0.8);
        box-shadow: 0 0 12px rgba(56, 225, 255, 0.55);
        opacity: 0;
        transition: opacity 120ms ease;
      }
      .range:hover::-webkit-slider-thumb,
      .range:focus-visible::-webkit-slider-thumb {
        opacity: 1;
      }
      .range:disabled {
        opacity: 0.4;
        cursor: default;
      }
      @media (max-width: 980px) {
        .player {
          grid-template-columns: minmax(140px, 1fr) minmax(280px, 1.4fr) auto;
        }
      }
      .player {
        position: relative;
        z-index: 110;
      }
      .player__hairline {
        display: none;
      }
      @media (max-width: 760px) {
        /* Phone mini-player: one compact row. Shuffle/repeat/seek/volume live in Now Playing and Queue. */
        .player {
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-areas: 'track transport';
          gap: 8px;
          padding: 8px 12px;
        }
        .player__track {
          grid-area: track;
          touch-action: none;
        }
        .player__transport {
          grid-area: transport;
        }
        .player__extras,
        .player__seek,
        .player__aux,
        .player__rate,
        .player__expand {
          display: none;
        }
        .player__hairline {
          display: block;
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--line);
        }
        .player__hairline span {
          display: block;
          height: 100%;
          background: var(--cyan-deep, #1b9fd0);
        }
      }
    `,
  ],
})
export class PlayerBarComponent {
  protected readonly playback = inject(PlaybackStore);
  protected readonly podcastPlayback = inject(PodcastPlaybackStore);
  protected readonly navigation = inject(NavigationStore);
  protected readonly native = isNativePlatform();
  protected readonly formatDuration = formatDuration;

  readonly openNow = output<void>();
  readonly openPodcast = output<void>();
  readonly openQueue = output<void>();

  constructor() {
    void this.podcastPlayback.init();
  }

  protected readonly dragging = signal(false);
  protected readonly dragValue = signal(0);
  protected readonly volumeOpen = signal(false);
  protected readonly pulsing = signal(false);
  protected readonly dragOffset = signal(0);
  private dragStartY: number | null = null;
  private dragged = false;
  private suppressClick = false;

  protected readonly podcastMode = computed(() => {
    // The active track is authoritative; the podcast store's active flag can
    // lag after switching back to music. The track also tells the bar which
    // player owns it, so a podcast opens the podcast screen, never music.
    const track = this.playback.track();
    if (track) return track.mediaKind === 'podcast' || track.sourceKind === 'podcast';
    return this.podcastPlayback.active();
  });
  private readonly podcastReady = computed(() => this.podcastPlayback.track() !== null);
  protected readonly track = computed(() =>
    this.podcastMode()
      ? (this.podcastPlayback.track() ?? this.playback.track())
      : this.playback.track(),
  );
  protected readonly state = computed(() =>
    this.podcastMode() && this.podcastReady()
      ? this.podcastPlayback.snapshot().state
      : this.playback.snapshot().state,
  );
  protected readonly isPlaying = computed(() =>
    this.podcastMode() && this.podcastReady()
      ? this.podcastPlayback.isPlaying()
      : this.playback.isPlaying(),
  );
  protected readonly rate = computed(() =>
    this.podcastMode() && this.podcastReady()
      ? this.podcastPlayback.rate()
      : this.playback.snapshot().rate,
  );
  protected readonly isVideo = computed(() => {
    const track = this.track();
    return track?.mediaForm === 'video' || track?.videoAvailable === true;
  });
  protected readonly videoPresentation = computed(() =>
    this.podcastMode() && this.podcastReady()
      ? this.podcastPlayback.presentation()
      : this.playback.snapshot().presentation,
  );
  /** Nothing loaded and nothing queued: transport controls have nothing to act on. */
  protected readonly idle = computed(
    () =>
      !this.track() &&
      (this.podcastMode()
        ? this.podcastPlayback.queue().entries.length === 0
        : this.playback.queue().entries.length === 0),
  );
  protected readonly displayPosition = computed(() =>
    this.dragging()
      ? this.dragValue()
      : this.podcastMode() && this.podcastReady()
        ? this.podcastPlayback.positionMs()
        : this.playback.positionMs(),
  );
  protected readonly displayDuration = computed(() =>
    Math.max(
      1,
      this.podcastMode() && this.podcastReady()
        ? this.podcastPlayback.durationMs()
        : this.playback.durationMs(),
    ),
  );
  protected readonly progressPercent = computed(() =>
    Math.min(100, (this.displayPosition() / this.displayDuration()) * 100),
  );
  protected readonly volumePercent = computed(() => this.playback.snapshot().volume * 100);

  protected togglePlay(): void {
    void (this.podcastMode() ? this.podcastPlayback.toggle() : this.playback.toggle());
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    this.pulsing.set(true);
    setTimeout(() => this.pulsing.set(false), 1000);
  }

  protected onSeekInput(event: Event): void {
    this.dragging.set(true);
    this.dragValue.set(Number((event.target as HTMLInputElement).value));
  }

  protected onSeekCommit(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.dragging.set(false);
    void (this.podcastMode() ? this.podcastPlayback.seek(value) : this.playback.seek(value));
  }

  protected onVolume(event: Event): void {
    void this.playback.setVolume(Number((event.target as HTMLInputElement).value));
  }

  protected previous(): void {
    void (this.podcastMode() ? this.podcastPlayback.previous() : this.playback.previous());
  }

  protected next(): void {
    void (this.podcastMode() ? this.podcastPlayback.next() : this.playback.next());
  }

  protected skip(deltaMs: number): void {
    if (!this.podcastMode()) return;
    void this.podcastPlayback.seekBy(deltaMs);
  }

  protected cycleRate(): void {
    if (!this.podcastMode()) return;
    const rates = [1, 1.25, 1.5, 1.75, 2];
    const index = rates.findIndex((rate) => Math.abs(rate - this.rate()) < 0.001);
    void this.podcastPlayback.setRate(rates[(index + 1) % rates.length]);
  }

  protected onTrackActivate(): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.openNow.emit();
  }

  /** A vertical upward drag on the mini player expands the full Now Playing view. */
  protected onDragStart(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    // Leave the transport, rate and volume controls to their own taps.
    if (target?.closest('button:not(.player__track), input, .range')) return;
    this.dragStartY = event.clientY;
    this.dragged = false;
    try {
      (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; the document still receives the release.
    }
  }

  protected onDragMove(event: PointerEvent): void {
    if (this.dragStartY === null) return;
    const dy = event.clientY - this.dragStartY;
    if (dy < -6) {
      this.dragged = true;
      if (event.cancelable) event.preventDefault();
    }
    this.dragOffset.set(Math.max(-96, Math.min(0, dy)));
  }

  protected onDragEnd(event: PointerEvent): void {
    const offset = this.dragOffset();
    const wasDragged = this.dragged;
    const hadStart = this.dragStartY !== null;
    this.dragStartY = null;
    this.dragged = false;
    this.dragOffset.set(0);
    try {
      (event.currentTarget as HTMLElement | null)?.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
    if (hadStart && !wasDragged) {
      // A tap on the track/background expands the player. Pointer capture can
      // retarget the following click, so handle it here and suppress the echo.
      this.suppressClick = true;
      window.setTimeout(() => (this.suppressClick = false), 350);
      this.openNow.emit();
      return;
    }
    if (wasDragged && offset < -48) {
      // The click event lands after pointerup; suppress the duplicate open.
      this.suppressClick = true;
      window.setTimeout(() => (this.suppressClick = false), 350);
      this.openNow.emit();
    }
  }

  protected onDragCancel(): void {
    this.dragStartY = null;
    this.dragged = false;
    this.dragOffset.set(0);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.volumeOpen.set(false);
  }
}
