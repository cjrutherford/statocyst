import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { ArtworkComponent } from '../components/artwork.component';
import { IconComponent } from '../components/icon.component';
import { PlaybackStore } from '../core/playback.store';
import { formatDuration, formatLongDuration, pluralize } from '../core/format';

@Component({
  selector: 'sc-queue-view',
  standalone: true,
  imports: [ArtworkComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="view" aria-labelledby="queue-heading">
      <header class="view__head">
        <div>
          <p class="eyebrow">Session queue</p>
          <h1 id="queue-heading">Queue</h1>
          <p class="lede">
            One authoritative queue, owned by the desktop host and restored after restart.
          </p>
        </div>
        <div class="actions">
          <button
            type="button"
            class="btn"
            [class.is-active]="playback.snapshot().shuffle"
            [attr.aria-pressed]="playback.snapshot().shuffle"
            (click)="playback.toggleShuffle()"
          >
            <sc-icon name="shuffle" /> Shuffle {{ playback.snapshot().shuffle ? 'on' : 'off' }}
          </button>
          <button
            type="button"
            class="btn"
            [class.is-active]="playback.snapshot().repeat !== 'off'"
            (click)="playback.cycleRepeat()"
          >
            <sc-icon [name]="playback.snapshot().repeat === 'one' ? 'repeat-one' : 'repeat'" />
            Repeat {{ playback.snapshot().repeat }}
          </button>
          <button
            type="button"
            class="btn btn--danger"
            [disabled]="playback.queue().entries.length === 0"
            (click)="clear()"
          >
            <sc-icon name="close" /> Clear
          </button>
        </div>
      </header>

      <div class="summary">
        <span>{{ pluralize(playback.queue().entries.length, 'track') }}</span>
        <span class="dot">·</span>
        <span>{{ formatLongDuration(playback.totalDurationMs()) }}</span>
        @if (playback.snapshot().currentEntryId) {
          <span class="dot">·</span>
          <span>{{ playback.currentIndex() + 1 }} current</span>
        }
      </div>

      @if (playback.queue().entries.length === 0) {
        <div class="empty">
          <sc-icon name="queue" />
          <h2>The queue is empty</h2>
          <p>Add tracks from the library, or play one to start a new queue.</p>
          <button type="button" class="btn btn--primary" (click)="openLibrary.emit()">
            <sc-icon name="library" /> Browse library
          </button>
        </div>
      } @else {
        <ol class="queue" aria-label="Playback queue">
          @for (entry of playback.queue().entries; track entry.entryId; let index = $index) {
            <li
              class="queue__item"
              [class.is-current]="playback.queue().currentEntryId === entry.entryId"
              [class.is-missing]="entry.track.missing"
            >
              <span class="queue__index">
                @if (
                  playback.queue().currentEntryId === entry.entryId && playback.isPlaying()
                ) {
                  <span class="equalizer" aria-label="Playing">
                    <i></i><i></i><i></i>
                  </span>
                } @else {
                  {{ index + 1 }}
                }
              </span>

              <button
                type="button"
                class="queue__main"
                [attr.aria-label]="'Play ' + entry.track.title"
                (click)="playback.playEntry(entry.entryId)"
              >
                <sc-artwork [track]="entry.track" size="sm" />
                <span class="queue__text">
                  <span class="queue__title">{{ entry.track.title }}</span>
                  <span class="queue__artist">{{ entry.track.artist }} · {{ entry.track.album }}</span>
                </span>
              </button>

              <span class="queue__time">{{ formatDuration(entry.track.durationMs) }}</span>

              <div class="queue__actions">
                <button
                  type="button"
                  class="icon-btn"
                  [disabled]="index === 0"
                  [attr.aria-label]="'Move ' + entry.track.title + ' up'"
                  title="Move up"
                  (click)="move(entry.entryId, index, -1)"
                >
                  <sc-icon name="up" />
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  [disabled]="index === playback.queue().entries.length - 1"
                  [attr.aria-label]="'Move ' + entry.track.title + ' down'"
                  title="Move down"
                  (click)="move(entry.entryId, index, 1)"
                >
                  <sc-icon name="down" />
                </button>
                <button
                  type="button"
                  class="icon-btn icon-btn--danger"
                  [attr.aria-label]="'Remove ' + entry.track.title + ' from queue'"
                  title="Remove from queue"
                  (click)="playback.removeEntry(entry.entryId)"
                >
                  <sc-icon name="close" />
                </button>
              </div>
            </li>
          }
        </ol>
      }
    </section>
  `,
  styles: [
    `
      .view {
        display: grid;
        gap: clamp(16px, 2vw, 24px);
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
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .summary {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.76rem;
        color: var(--muted);
        letter-spacing: 0.04em;
      }
      .dot {
        opacity: 0.5;
      }
      .empty {
        display: grid;
        justify-items: center;
        gap: 10px;
        text-align: center;
        padding: clamp(40px, 7vw, 84px) 20px;
        border: 1px dashed var(--line);
        border-radius: var(--radius);
        color: var(--muted);
        font-size: 2.2rem;
      }
      .empty h2 {
        margin: 4px 0 0;
        font-size: 1.4rem;
        color: var(--text);
      }
      .empty p {
        margin: 0 0 8px;
        font-size: 0.9rem;
        max-width: 42ch;
      }
      .queue {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 6px;
      }
      .queue__item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        border-radius: 14px;
        border: 1px solid transparent;
        background: var(--surface-3);
        transition: border-color 140ms ease, background 140ms ease;
      }
      .queue__item:hover {
        border-color: var(--line);
        background: var(--surface-2);
      }
      .queue__item.is-current {
        border-color: rgba(56, 225, 255, 0.34);
        background: linear-gradient(90deg, rgba(56, 225, 255, 0.12), var(--surface-2));
      }
      .queue__item.is-missing .queue__title {
        color: var(--muted);
        text-decoration: line-through;
        text-decoration-color: rgba(255, 107, 138, 0.5);
      }
      .queue__index {
        width: 24px;
        text-align: center;
        color: var(--muted);
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums;
      }
      .queue__main {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 12px;
        background: none;
        border: 0;
        padding: 0;
        color: inherit;
        text-align: left;
        cursor: pointer;
        min-width: 0;
      }
      .queue__text {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .queue__title {
        font-weight: 600;
        font-size: 0.88rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .queue__artist {
        color: var(--muted);
        font-size: 0.72rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .queue__time {
        font-size: 0.74rem;
        color: var(--muted);
        font-variant-numeric: tabular-nums;
      }
      .queue__actions {
        display: flex;
        gap: 2px;
      }
      .icon-btn--danger:hover {
        color: var(--danger);
        background: rgba(255, 107, 138, 0.12);
      }
      .equalizer {
        display: inline-flex;
        align-items: flex-end;
        gap: 2px;
        height: 14px;
        margin-left: -3px;
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
      @media (max-width: 640px) {
        .queue__artist,
        .queue__time {
          display: none;
        }
      }
    `,
  ],
})
export class QueueViewComponent {
  protected readonly playback = inject(PlaybackStore);
  protected readonly formatDuration = formatDuration;
  protected readonly formatLongDuration = formatLongDuration;
  protected readonly pluralize = pluralize;

  readonly openLibrary = output<void>();

  protected move(entryId: string, index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= this.playback.queue().entries.length) return;
    void this.playback.moveEntry(entryId, target);
  }

  protected clear(): void {
    if (this.playback.queue().entries.length === 0) return;
    if (window.confirm('Clear the entire queue? Playback will stop.')) {
      void this.playback.clearQueue();
    }
  }
}
