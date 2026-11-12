import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { ArtworkComponent } from '../components/artwork.component';
import { IconComponent } from '../components/icon.component';
import { PodcastVideoStageComponent } from '../components/podcast-video-stage.component';
import { PodcastPlaybackStore } from '../core/podcast-playback.store';
import { ScreenTransitionService } from '../core/screen-transition.service';
import { formatDuration } from '../core/format';

/**
 * Full-screen player for the podcast context. The mini player opens this for
 * podcast tracks so the video stage, seek and episode controls have room;
 * music keeps its own Now Playing view.
 */
@Component({
  selector: 'sc-podcast-now-playing',
  standalone: true,
  imports: [ArtworkComponent, IconComponent, PodcastVideoStageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="view" aria-labelledby="podcast-now-heading">
      <header class="view__head">
        <div>
          <p class="eyebrow">Now playing · Podcast</p>
          <h1 id="podcast-now-heading">{{ track()?.album || 'Podcast episode' }}</h1>
        </div>
        <div class="head-actions">
          <button type="button" class="btn btn--quiet" (click)="minimize()">
            <sc-icon name="down" /> Minimize
          </button>
          <button type="button" class="btn btn--quiet" (click)="openPodcasts.emit()">
            <sc-icon name="podcast" /> All podcasts
          </button>
        </div>
      </header>

      @if (track(); as track) {
        <sc-podcast-video-stage />

        <div class="episode" [class.episode--video]="hasVideo()">
          <div class="episode__art" [class.is-hidden]="hasVideo() && presentation() === 'video'">
            <sc-artwork [track]="track" size="hero" />
          </div>
          <div class="episode__body">
            <p class="eyebrow">{{ track.artist }}</p>
            <h2>{{ track.title }}</h2>
            <div class="chips">
              @if (track.mediaForm === 'video') {
                <span class="chip">Video</span>
              }
              <span class="chip">Podcast</span>
              <span class="chip">{{ formatDuration(track.durationMs) }}</span>
              @if (queuePosition() > 0) {
                <span class="chip">
                  {{ queuePosition() }} of {{ queueLength() }} in queue
                </span>
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
                class="icon-btn skip"
                aria-label="Skip back 15 seconds"
                title="Skip back 15 seconds"
                (click)="skip(-15000)"
              >
                15
              </button>
              <button
                type="button"
                class="icon-btn"
                aria-label="Previous episode"
                (click)="playback.previous()"
              >
                <sc-icon name="previous" />
              </button>
              <button
                type="button"
                class="play"
                [attr.aria-label]="playing() ? 'Pause' : 'Play'"
                (click)="toggle()"
              >
                <sc-icon [name]="playing() ? 'pause' : 'play'" />
              </button>
              <button
                type="button"
                class="icon-btn"
                aria-label="Next episode"
                (click)="playback.next()"
              >
                <sc-icon name="next" />
              </button>
              <button
                type="button"
                class="icon-btn skip"
                aria-label="Skip forward 30 seconds"
                title="Skip forward 30 seconds"
                (click)="skip(30000)"
              >
                30
              </button>
              <button
                type="button"
                class="rate"
                [attr.aria-label]="'Playback speed ' + rate() + ' times'"
                (click)="cycleRate()"
              >
                {{ rate() }}×
              </button>
            </div>
            <p class="state">{{ stateLabel() }}</p>
          </div>
        </div>

        @if (upNext().length > 0) {
          <section class="upnext" aria-labelledby="podcast-upnext-heading">
            <div class="section-head">
              <h2 id="podcast-upnext-heading">Coming up</h2>
              <span>{{ upNext().length }} queued</span>
            </div>
            <ul>
              @for (entry of upNext(); track entry.entryId) {
                <li>
                  <button type="button" class="upnext__item" (click)="playEntry(entry.entryId)">
                    <sc-artwork [track]="entry.track" size="sm" />
                    <span class="upnext__meta">
                      <span class="upnext__title">{{ entry.track.title }}</span>
                      <span class="upnext__artist">{{ entry.track.artist }}</span>
                    </span>
                    <span class="upnext__time">{{ formatDuration(entry.track.durationMs) }}</span>
                  </button>
                </li>
              }
            </ul>
          </section>
        }
      } @else {
        <div class="empty">
          <sc-icon name="wave" />
          <h2>No episode playing</h2>
          <p>Choose an episode from Podcasts to start listening or watching.</p>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .view {
        display: grid;
        gap: clamp(18px, 2.4vw, 30px);
        padding: clamp(20px, 3vw, 40px);
        max-width: 980px;
        margin: 0 auto;
        animation: rise 380ms ease both;
      }
      .view__head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: flex-end;
        gap: 16px;
      }
      .view__head h1 {
        margin: 2px 0 0;
        font-size: clamp(1.5rem, 4vw, 2.4rem);
      }
      .head-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .episode {
        display: grid;
        grid-template-columns: minmax(160px, 260px) minmax(0, 1fr);
        gap: clamp(18px, 3vw, 34px);
        align-items: center;
      }
      .episode--video {
        grid-template-columns: minmax(0, 1fr);
      }
      .episode__art {
        overflow: hidden;
        border-radius: var(--radius-lg);
        aspect-ratio: 1;
        background: var(--surface-2);
        box-shadow: var(--shadow);
      }
      .episode__art.is-hidden {
        display: none;
      }
      .episode__body h2 {
        margin: 4px 0 0;
        font-size: clamp(1.3rem, 3vw, 2rem);
        line-height: 1.15;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 12px 0 18px;
      }
      .chip {
        padding: 5px 10px;
        border: 1px solid var(--line);
        border-radius: 999px;
        font-size: 0.66rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .seek {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        margin: 8px 0 14px;
      }
      .time {
        color: var(--muted);
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums;
      }
      .range {
        width: 100%;
        accent-color: var(--cyan);
      }
      .controls {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: clamp(8px, 2vw, 18px);
        flex-wrap: wrap;
        margin: 10px 0 4px;
      }
      .icon-btn {
        min-width: 42px;
        height: 42px;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: var(--text);
        display: inline-grid;
        place-items: center;
        cursor: pointer;
      }
      .icon-btn:hover {
        background: var(--surface-2);
      }
      .skip {
        font-size: 0.7rem;
        font-weight: 700;
        border: 1px solid var(--line);
      }
      .play {
        width: 68px;
        height: 68px;
        border: 0;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--cyan), var(--violet));
        color: #04101f;
        display: grid;
        place-items: center;
        cursor: pointer;
        box-shadow: 0 12px 28px rgba(56, 225, 255, 0.22);
      }
      .rate {
        min-width: 48px;
        height: 38px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: transparent;
        color: var(--text);
        font: inherit;
        font-size: 0.78rem;
        cursor: pointer;
      }
      .state {
        text-align: center;
        color: var(--muted);
        font-size: 0.68rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .upnext {
        display: grid;
        gap: 12px;
      }
      .section-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }
      .section-head h2 {
        margin: 0;
        font-size: 1rem;
      }
      .section-head span {
        color: var(--muted);
        font-size: 0.7rem;
      }
      .upnext ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 6px;
      }
      .upnext__item {
        width: 100%;
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        padding: 8px;
        border: 1px solid transparent;
        border-radius: var(--radius-md);
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .upnext__item:hover {
        border-color: var(--line);
        background: var(--surface-2);
      }
      .upnext__meta {
        display: grid;
        min-width: 0;
      }
      .upnext__title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.86rem;
      }
      .upnext__artist,
      .upnext__time {
        color: var(--muted);
        font-size: 0.72rem;
      }
      .empty {
        display: grid;
        justify-items: center;
        gap: 8px;
        padding: 48px 20px;
        text-align: center;
        color: var(--muted);
      }
      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @media (max-width: 640px) {
        .episode {
          grid-template-columns: minmax(0, 1fr);
        }
        .episode__art {
          max-width: 240px;
          margin: 0 auto;
        }
        .controls {
          gap: 6px;
        }
        .play {
          width: 60px;
          height: 60px;
        }
      }
    `,
  ],
})
export class PodcastNowPlayingComponent {
  protected readonly playback = inject(PodcastPlaybackStore);
  private readonly transitions = inject(ScreenTransitionService);
  readonly openPodcasts = output<void>();

  protected readonly formatDuration = formatDuration;
  protected readonly dragging = signal(false);
  protected readonly dragValue = signal(0);

  protected readonly track = computed(() => this.playback.track());
  protected readonly playing = computed(() => this.playback.isPlaying());
  protected readonly presentation = computed(() => this.playback.presentation());
  protected readonly hasVideo = computed(() => this.playback.hasVideo());
  protected readonly rate = computed(() => this.playback.rate());
  protected readonly upNext = computed(() => this.playback.upNext());
  protected readonly queuePosition = computed(() => this.playback.currentIndex() + 1);
  protected readonly queueLength = computed(() => this.playback.queue().entries.length);
  protected readonly displayPosition = computed(() =>
    this.dragging() ? this.dragValue() : this.playback.positionMs(),
  );
  protected readonly displayDuration = computed(() =>
    Math.max(1, this.playback.durationMs()),
  );
  protected readonly progressPercent = computed(() =>
    Math.min(100, (this.displayPosition() / this.displayDuration()) * 100),
  );
  protected readonly stateLabel = computed(() => {
    const state = this.playback.snapshot().state;
    if (state === 'buffering') return 'Buffering';
    if (state === 'waiting-network') return 'Offline — will resume';
    if (state === 'error') return 'Playback error';
    if (state === 'ended') return 'Ended';
    if (state === 'paused') return 'Paused';
    return this.playing() ? 'Playing' : 'Ready';
  });

  constructor() {
    void this.playback.init();
  }

  protected minimize(): void {
    if (!this.transitions.back()) void this.transitions.go('podcasts');
  }

  protected toggle(): void {
    void this.playback.toggle();
  }

  protected skip(deltaMs: number): void {
    void this.playback.seekBy(deltaMs);
  }

  protected playEntry(entryId: string): void {
    void this.playback.command({ type: 'playEntry', entryId });
  }

  protected cycleRate(): void {
    const rates = [1, 1.25, 1.5, 1.75, 2, 0.8];
    const current = this.rate();
    const index = rates.findIndex((candidate) => Math.abs(candidate - current) < 0.01);
    const next = rates[(index + 1) % rates.length] ?? 1;
    void this.playback.setRate(next);
  }

  protected onSeekInput(event: Event): void {
    this.dragging.set(true);
    this.dragValue.set(Number((event.target as HTMLInputElement).value));
  }

  protected onSeekCommit(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.dragging.set(false);
    void this.playback.seek(value);
  }
}
