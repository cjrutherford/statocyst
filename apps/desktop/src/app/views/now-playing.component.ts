import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { ArtworkComponent } from '../components/artwork.component';
import { IconComponent } from '../components/icon.component';
import { PlaybackStore } from '../core/playback.store';
import { RadioStore } from '../core/radio.store';
import { LibraryStore } from '../core/library.store';
import { formatDuration, formatLabel, pluralize } from '../core/format';

@Component({
  selector: 'sc-now-playing',
  standalone: true,
  imports: [ArtworkComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="view" aria-labelledby="now-heading">
      <header class="view__head">
        <div>
          <p class="eyebrow">Now playing</p>
          <h1 id="now-heading">The deep channel</h1>
        </div>
        <button type="button" class="btn btn--quiet" (click)="openQueue.emit()">
          <sc-icon name="queue" /> Open queue
        </button>
      </header>

      @if (playback.track(); as track) {
        <div class="stage" [class.is-live]="playback.isPlaying()">
          <div class="stage__art">
            <div class="sonar" aria-hidden="true">
              <span></span><span></span><span></span>
            </div>
            <sc-artwork [track]="track" size="hero" />
            <div class="stage__pearl" aria-hidden="true"></div>
          </div>

          <div class="stage__info">
            @if (track.missing) {
              <div class="warning" role="alert">
                <sc-icon name="alert" />
                <span>This file is missing from disk. Re-import it or remove the track.</span>
              </div>
            }
            <p class="eyebrow">{{ track.album }}</p>
            <h2 class="title">{{ track.title }}</h2>
            <p class="artist">{{ track.artist }}</p>

            <div class="chips">
              <span class="chip">{{ formatLabel(track.format) }}</span>
              @if (track.year) {
                <span class="chip">{{ track.year }}</span>
              }
              <span class="chip">{{ track.sourceLabel }}</span>
              @if (playback.currentIndex() >= 0) {
                <span class="chip">
                  {{ playback.currentIndex() + 1 }} of {{ playback.queue().entries.length }} in queue
                </span>
              }
              @if (track.albumArtist && track.albumArtist !== track.artist) {
                <span class="chip">{{ track.albumArtist }}</span>
              }
            </div>

            <div class="seek">
              <span class="time">{{ formatDuration(displayPosition()) }}</span>
              <input
                class="range"
                type="range"
                min="0"
                [max]="displayDuration()"
                step="250"
                [value]="displayPosition()"
                [style.--progress]="progressPercent() + '%'"
                aria-label="Seek position"
                (input)="onSeekInput($event)"
                (change)="onSeekCommit($event)"
              />
              <span class="time">{{ formatDuration(displayDuration()) }}</span>
            </div>

            <div class="controls">
              <button
                type="button"
                class="icon-btn icon-btn--lg"
                [class.is-active]="playback.snapshot().shuffle"
                [attr.aria-pressed]="playback.snapshot().shuffle"
                aria-label="Shuffle queue"
                (click)="playback.toggleShuffle()"
              >
                <sc-icon name="shuffle" />
              </button>
              <button
                type="button"
                class="icon-btn icon-btn--lg"
                aria-label="Previous track"
                (click)="playback.previous()"
              >
                <sc-icon name="previous" />
              </button>
              <button
                type="button"
                class="play"
                [attr.aria-label]="playback.isPlaying() ? 'Pause' : 'Play'"
                (click)="playback.toggle()"
              >
                <sc-icon [name]="playback.isPlaying() ? 'pause' : 'play'" />
              </button>
              <button
                type="button"
                class="icon-btn icon-btn--lg"
                aria-label="Next track"
                (click)="playback.next()"
              >
                <sc-icon name="next" />
              </button>
              <button
                type="button"
                class="icon-btn icon-btn--lg"
                [class.is-active]="playback.snapshot().repeat !== 'off'"
                [attr.aria-label]="'Repeat ' + playback.snapshot().repeat"
                (click)="playback.cycleRepeat()"
              >
                <sc-icon [name]="playback.snapshot().repeat === 'one' ? 'repeat-one' : 'repeat'" />
              </button>
            </div>

            <div class="volume">
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
              <span class="state">{{ stateLabel() }}</span>
            </div>

            <div class="more">
              <button type="button" class="btn" (click)="radio.start(track)">Start radio</button>
              <button type="button" class="btn btn--quiet" (click)="radio.saveAsPlaylist(track)">
                Save radio as playlist
              </button>
            </div>
          </div>
        </div>

        <div class="upnext">
          <div class="upnext__head">
            <h2>Up next</h2>
            <span>{{ pluralize(playback.queue().entries.length, 'track') }} queued</span>
          </div>
          @if (playback.upNext().length === 0) {
            <p class="upnext__empty">
              The queue ends here. Add more from the library or enable repeat.
            </p>
          } @else {
            <ul>
              @for (entry of playback.upNext(); track entry.entryId; let index = $index) {
                <li [style.--i]="index">
                  <button type="button" class="upnext__item" (click)="playback.playEntry(entry.entryId)">
                    <sc-artwork [track]="entry.track" size="sm" />
                    <span class="upnext__text">
                      <span class="upnext__title">{{ entry.track.title }}</span>
                      <span class="upnext__artist">{{ entry.track.artist }}</span>
                    </span>
                    <span class="upnext__time">{{ formatDuration(entry.track.durationMs) }}</span>
                    <sc-icon name="play" />
                  </button>
                </li>
              }
            </ul>
          }
        </div>
      } @else {
        <div class="empty">
          <div class="empty__orb">
            <img src="branding/statocyst-symbol.png" alt="" />
          </div>
          <h2>No track selected</h2>
          <p>
            @if (library.tracks().length > 0) {
              Pick a track from your library to light up the deep channel.
            } @else {
              Import audio first, then choose a track to begin.
            }
          </p>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .view {
        display: grid;
        gap: clamp(24px, 3vw, 40px);
        padding: clamp(20px, 3vw, 38px);
        max-width: 1320px;
        margin: 0 auto;
        animation: rise 420ms ease both;
      }
      .view__head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }
      h1 {
        margin: 4px 0 0;
        font-size: clamp(1.7rem, 2.8vw, 2.4rem);
        letter-spacing: -0.02em;
      }
      .stage {
        display: grid;
        grid-template-columns: minmax(280px, 0.9fr) minmax(320px, 1.1fr);
        gap: clamp(24px, 4vw, 60px);
        align-items: center;
      }
      .stage__art {
        position: relative;
        max-width: 520px;
        width: 100%;
        margin: 0 auto;
      }
      .stage__art sc-artwork {
        position: relative;
        z-index: 2;
        display: block;
        box-shadow:
          0 40px 120px rgba(0, 8, 26, 0.75),
          0 0 0 1px rgba(56, 225, 255, 0.12);
      }
      .is-live .stage__art sc-artwork {
        animation: float 6.5s ease-in-out infinite;
      }
      .stage__pearl {
        position: absolute;
        inset: 12% 12% auto;
        height: 58%;
        border-radius: 50%;
        background: radial-gradient(circle at 50% 70%, rgba(255, 255, 255, 0.18), transparent 62%);
        filter: blur(22px);
        z-index: 1;
        pointer-events: none;
      }
      .sonar {
        position: absolute;
        inset: -9%;
        display: grid;
        place-items: center;
        z-index: 0;
        pointer-events: none;
      }
      .sonar span {
        position: absolute;
        width: 100%;
        aspect-ratio: 1;
        border-radius: 50%;
        border: 1px solid rgba(56, 225, 255, 0.22);
        opacity: 0;
      }
      .is-live .sonar span {
        animation: sonar 5.2s cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
      }
      .sonar span:nth-child(2) {
        animation-delay: 1.7s;
      }
      .sonar span:nth-child(3) {
        animation-delay: 3.4s;
      }
      .stage__info {
        display: grid;
        gap: 12px;
        min-width: 0;
      }
      .title {
        margin: 0;
        font-size: clamp(2rem, 3.6vw, 3.4rem);
        line-height: 1.02;
        letter-spacing: -0.035em;
        overflow-wrap: anywhere;
      }
      .artist {
        margin: 0;
        font-size: 1.08rem;
        color: var(--cyan);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        margin-top: 2px;
      }
      .chip {
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: var(--surface-2);
        font-size: 0.68rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .seek {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 10px;
      }
      .time {
        font-variant-numeric: tabular-nums;
        font-size: 0.72rem;
        color: var(--muted);
        min-width: 36px;
        text-align: center;
      }
      .range {
        appearance: none;
        flex: 1;
        height: 20px;
        background: transparent;
        cursor: pointer;
      }
      .range::-webkit-slider-runnable-track {
        height: 5px;
        border-radius: 999px;
        background: linear-gradient(
          90deg,
          var(--cyan),
          var(--violet) var(--progress, 0%),
          rgba(148, 197, 255, 0.16) var(--progress, 0%)
        );
      }
      .range::-webkit-slider-thumb {
        appearance: none;
        width: 14px;
        height: 14px;
        margin-top: -4.5px;
        border-radius: 50%;
        background: var(--pearl);
        border: 1px solid rgba(56, 225, 255, 0.9);
        box-shadow: 0 0 16px rgba(56, 225, 255, 0.6);
      }
      .controls {
        display: flex;
        align-items: center;
        gap: clamp(10px, 1.6vw, 20px);
        margin-top: 8px;
      }
      .play {
        width: 72px;
        height: 72px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        border: 1px solid rgba(56, 225, 255, 0.6);
        background:
          radial-gradient(circle at 32% 24%, rgba(255, 255, 255, 0.4), transparent 46%),
          linear-gradient(160deg, #61ebff, #22a6dc 52%, #7c6bf7);
        color: #03121f;
        font-size: 1.9rem;
        cursor: pointer;
        box-shadow:
          0 0 42px rgba(56, 225, 255, 0.34),
          inset 0 1px 0 rgba(255, 255, 255, 0.45);
        transition: transform 130ms ease, box-shadow 180ms ease;
      }
      .play:hover {
        transform: scale(1.04);
        box-shadow: 0 0 56px rgba(56, 225, 255, 0.5);
      }
      .play:active {
        transform: scale(0.97);
      }
      .icon-btn--lg {
        font-size: 1.35rem;
      }
      .volume {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 6px;
      }
      .range--volume {
        flex: none;
        width: 160px;
      }
      .state {
        font-size: 0.66rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .warning {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 12px;
        background: rgba(255, 107, 138, 0.08);
        border: 1px solid rgba(255, 107, 138, 0.32);
        color: #ffb4c4;
        font-size: 0.82rem;
      }
      .upnext {
        border: 1px solid var(--line);
        background: var(--surface-3);
        border-radius: var(--radius);
        padding: 18px 20px;
      }
      .upnext__head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }
      .upnext__head h2 {
        margin: 0;
        font-size: 1rem;
        letter-spacing: 0.02em;
      }
      .upnext__head span {
        font-size: 0.72rem;
        color: var(--muted);
      }
      .upnext ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 4px;
      }
      .upnext li {
        animation: upnext-in 360ms ease both;
        animation-delay: min(calc(var(--i, 0) * 30ms), 420ms);
      }
      .upnext__item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 7px 8px;
        border-radius: 12px;
        border: 1px solid transparent;
        background: none;
        color: inherit;
        text-align: left;
        cursor: pointer;
        font-size: 1.1rem;
      }
      .upnext__item:hover {
        background: rgba(56, 225, 255, 0.06);
        border-color: rgba(56, 225, 255, 0.16);
      }
      .upnext__text {
        display: grid;
        gap: 2px;
        min-width: 0;
        flex: 1;
      }
      .upnext__title {
        font-size: 0.86rem;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .upnext__artist {
        font-size: 0.72rem;
        color: var(--muted);
      }
      .upnext__time {
        font-size: 0.72rem;
        color: var(--muted);
        font-variant-numeric: tabular-nums;
      }
      .upnext__empty {
        margin: 0;
        color: var(--muted);
        font-size: 0.84rem;
      }
      .empty {
        display: grid;
        justify-items: center;
        gap: 12px;
        text-align: center;
        padding: clamp(30px, 7vw, 80px) 20px;
      }
      .empty__orb {
        width: 160px;
        height: 160px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        border: 1px solid rgba(56, 225, 255, 0.2);
        box-shadow: 0 0 60px rgba(56, 225, 255, 0.12) inset;
      }
      .empty__orb img {
        width: 96px;
        opacity: 0.75;
        filter: drop-shadow(0 0 20px rgba(56, 225, 255, 0.35));
      }
      .empty h2 {
        margin: 0;
      }
      .empty p {
        margin: 0;
        color: var(--muted);
        max-width: 46ch;
      }
      @keyframes sonar {
        0% {
          transform: scale(0.72);
          opacity: 0.55;
        }
        70% {
          opacity: 0.08;
        }
        100% {
          transform: scale(1.22);
          opacity: 0;
        }
      }
      @keyframes float {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-9px);
        }
      }
      @keyframes upnext-in {
        from {
          opacity: 0;
          transform: translateX(-8px);
        }
        to {
          opacity: 1;
          transform: none;
        }
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
      @media (max-width: 900px) {
        .view {
          gap: 16px;
        }
        .stage {
          grid-template-columns: 1fr;
        }
        .stage__art {
          max-width: min(380px, 24vh);
        }
        /* Long titles must not push the transport controls off a phone screen. */
        .title {
          font-size: clamp(1.45rem, 6.2vw, 2.1rem);
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .artist {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      }
      @media (max-width: 900px) and (max-height: 760px) {
        .stage__art {
          max-width: min(260px, 24vh);
        }
        .title {
          -webkit-line-clamp: 2;
        }
      }
      .more {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
    `,
  ],
})
export class NowPlayingViewComponent {
  protected readonly playback = inject(PlaybackStore);
  protected readonly radio = inject(RadioStore);
  protected readonly library = inject(LibraryStore);
  protected readonly formatDuration = formatDuration;
  protected readonly formatLabel = formatLabel;
  protected readonly pluralize = pluralize;

  readonly openQueue = output<void>();

  protected readonly dragging = signal(false);
  protected readonly dragValue = signal(0);

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
  protected readonly stateLabel = computed(() => {
    const state = this.playback.snapshot().state;
    if (state === 'buffering') return 'Buffering';
    if (state === 'error') return 'Audio error';
    if (state === 'ended') return 'Ended';
    if (state === 'paused') return 'Paused';
    return this.playback.isPlaying() ? 'Playing' : 'Ready';
  });

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
