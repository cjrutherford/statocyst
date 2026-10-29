import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { ArtworkComponent } from './artwork.component';
import { IconComponent } from './icon.component';
import { PlaybackStore } from '../core/playback.store';
import { formatDuration } from '../core/format';

@Component({
  selector: 'sc-player-bar',
  standalone: true,
  imports: [ArtworkComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="player">
      <div class="player__hairline" aria-hidden="true">
        <span [style.width.%]="progressPercent()"></span>
      </div>
      <button
        type="button"
        class="player__track"
        (click)="openNow.emit()"
        [attr.aria-label]="
          playback.track()
            ? 'Open now playing: ' + playback.track()!.title
            : 'No track selected'
        "
      >
        <sc-artwork [track]="playback.track()" size="md" />
        <span class="player__meta">
          <span class="player__title">{{ playback.track()?.title ?? 'Nothing playing yet' }}</span>
          <span class="player__artist">
            {{ playback.track()?.artist ?? 'Pick a track from your library' }}
          </span>
        </span>
        @if (playback.snapshot().state === 'buffering') {
          <span class="player__state">Buffering</span>
        }
        @if (playback.snapshot().state === 'error') {
          <span class="player__state player__state--error">Audio error</span>
        }
        <sc-icon name="up" class="player__expand" />
      </button>

      <div class="player__transport">
        <div class="player__controls">
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
          <button
            type="button"
            class="icon-btn"
            aria-label="Previous track"
            [disabled]="idle()"
            title="Previous (P)"
            (click)="playback.previous()"
          >
            <sc-icon name="previous" />
          </button>
          <button
            type="button"
            class="player__play"
            [class.is-live]="playback.isPlaying()"
            [attr.aria-label]="playback.isPlaying() ? 'Pause' : 'Play'"
            title="Play or pause (Space)"
            [disabled]="idle()"
            (click)="playback.toggle()"
          >
            <sc-icon [name]="playback.isPlaying() ? 'pause' : 'play'" />
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label="Next track"
            [disabled]="idle()"
            title="Next (N)"
            (click)="playback.next()"
          >
            <sc-icon name="next" />
          </button>
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
            [disabled]="!playback.track()"
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
          [attr.aria-label]="playback.snapshot().muted ? 'Unmute' : 'Mute'"
          [title]="playback.snapshot().muted ? 'Unmute (M)' : 'Mute (M)'"
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
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
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
        .range--volume {
          display: none;
        }
      }
      .player {
        position: relative;
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
        }
        .player__transport {
          grid-area: transport;
        }
        .player__extras,
        .player__seek,
        .player__aux,
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
  protected readonly formatDuration = formatDuration;

  readonly openNow = output<void>();
  readonly openQueue = output<void>();

  protected readonly dragging = signal(false);
  protected readonly dragValue = signal(0);

  /** Nothing loaded and nothing queued: transport controls have nothing to act on. */
  protected readonly idle = computed(
    () => !this.playback.track() && this.playback.queue().entries.length === 0,
  );
  protected readonly displayPosition = computed(() =>
    this.dragging() ? this.dragValue() : this.playback.snapshot().positionMs,
  );
  protected readonly displayDuration = computed(() =>
    Math.max(1, this.playback.snapshot().durationMs),
  );
  protected readonly progressPercent = computed(() =>
    Math.min(100, (this.displayPosition() / this.displayDuration()) * 100),
  );
  protected readonly volumePercent = computed(() => this.playback.snapshot().volume * 100);

  protected onSeekInput(event: Event): void {
    this.dragging.set(true);
    this.dragValue.set(Number((event.target as HTMLInputElement).value));
  }

  protected onSeekCommit(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.dragging.set(false);
    void this.playback.seek(value);
  }

  protected onVolume(event: Event): void {
    void this.playback.setVolume(Number((event.target as HTMLInputElement).value));
  }
}
