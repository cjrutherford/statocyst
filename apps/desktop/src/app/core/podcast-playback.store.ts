import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import type {
  PlaybackCommand,
  PlaybackEvent,
  PlaybackSnapshot,
  PodcastEpisode,
  QueueSnapshot,
  Result,
} from '@statocyst/contracts';
import { bridge } from './bridge';

const EMPTY_SNAPSHOT: PlaybackSnapshot = {
  state: 'idle',
  currentEntryId: null,
  positionMs: 0,
  durationMs: 0,
  volume: 0.85,
  muted: false,
  shuffle: false,
  repeat: 'off',
  rate: 1,
  context: 'podcast',
  active: false,
  track: null,
};

const EMPTY_QUEUE: QueueSnapshot = {
  entries: [],
  currentEntryId: null,
  shuffle: false,
  repeat: 'off',
  context: 'podcast',
  active: false,
};

/**
 * Renderer view of the podcast playback context. The authoritative queue and
 * audio engine still live in the host; this store only mirrors the podcast
 * context and always addresses it explicitly.
 */
@Injectable({ providedIn: 'root' })
export class PodcastPlaybackStore {
  private readonly destroyRef = inject(DestroyRef);
  private initialised = false;
  private stateRevision = 0;
  private positionRevision = 0;
  private queueRevision = 0;

  readonly snapshot = signal<PlaybackSnapshot>({ ...EMPTY_SNAPSHOT });
  readonly queue = signal<QueueSnapshot>({ ...EMPTY_QUEUE });
  readonly positionMs = signal(0);
  readonly durationMs = signal(0);
  readonly ready = signal(false);
  readonly lastError = signal<string | null>(null);

  readonly track = computed(() => this.snapshot().track);
  readonly active = computed(() => {
    const snapshot = this.snapshot();
    return snapshot.active && (snapshot.currentEntryId !== null || snapshot.track !== null);
  });
  readonly isPlaying = computed(() => {
    if (!this.snapshot().active) return false;
    const state = this.snapshot().state;
    return state === 'playing' || state === 'buffering' || state === 'waiting-network';
  });
  readonly rate = computed(() => this.snapshot().rate);
  readonly progress = computed(() => {
    const duration = this.durationMs();
    return duration > 0 ? Math.min(1, Math.max(0, this.positionMs() / duration)) : 0;
  });
  readonly currentIndex = computed(() => {
    const { entries, currentEntryId } = this.queue();
    return currentEntryId ? entries.findIndex((entry) => entry.entryId === currentEntryId) : -1;
  });
  readonly upNext = computed(() => {
    const queue = this.queue();
    const index = this.currentIndex();
    return index < 0 ? queue.entries.slice(0, 3) : queue.entries.slice(index + 1, index + 4);
  });

  async init(): Promise<void> {
    if (this.initialised) return;
    this.initialised = true;
    const api = bridge();
    if (!api.podcast) {
      this.ready.set(true);
      return;
    }
    const unsubscribe = api.playback.onEvent((event) => this.handleEvent(event));
    this.destroyRef.onDestroy(unsubscribe);
    try {
      const stateRevision = this.stateRevision;
      const positionRevision = this.positionRevision;
      const queueRevision = this.queueRevision;
      const [snapshot, queue] = await Promise.all([
        api.playback.getSnapshot('podcast'),
        api.playback.getQueue('podcast'),
      ]);
      if (this.stateRevision === stateRevision) {
        this.snapshot.set(snapshot);
        if (this.positionRevision === positionRevision) {
          this.positionMs.set(snapshot.positionMs);
          this.durationMs.set(snapshot.durationMs);
        }
      }
      if (this.queueRevision === queueRevision) this.queue.set(queue);
      this.ready.set(true);
    } catch (error) {
      this.lastError.set(String(error));
    }
  }

  async command(command: PlaybackCommand): Promise<Result<PlaybackSnapshot>> {
    let result: Result<PlaybackSnapshot>;
    try {
      result = await bridge().playback.command(command, 'podcast');
    } catch (error) {
      result = { ok: false, error: { code: 'INTERNAL_ERROR', message: String(error) } };
    }
    if (!result.ok) {
      this.lastError.set(result.error.message);
      return result;
    }
    this.snapshot.set(result.value);
    this.positionMs.set(result.value.positionMs);
    this.durationMs.set(result.value.durationMs);
    this.lastError.set(null);
    this.queue.set(await bridge().playback.getQueue('podcast').catch(() => this.queue()));
    return result;
  }

  /**
   * Play an episode. `context` is the show/list order the episode was picked
   * from; the host seeds the podcast queue with those media ids.
   */
  async playEpisode(
    episode: PodcastEpisode,
    context: readonly PodcastEpisode[] = [],
  ): Promise<void> {
    const ids = context.length > 1 ? context.map((entry) => entry.id) : undefined;
    const result = await this.command({
      type: 'play',
      trackId: episode.id,
      ...(ids ? { contextTrackIds: ids } : {}),
    });
    if (result.ok && !episode.completed && episode.resumePositionMs > 0) {
      await this.command({ type: 'seek', positionMs: episode.resumePositionMs });
    }
  }

  async toggle(): Promise<void> {
    const snapshot = this.snapshot();
    if (!snapshot.active) {
      await this.command({ type: 'play' });
      return;
    }
    if (this.isPlaying()) {
      await this.command({ type: 'pause' });
      return;
    }
    if (snapshot.state === 'ended' && snapshot.currentEntryId) {
      await this.command({ type: 'seek', positionMs: 0 });
    }
    await this.command({ type: 'play' });
  }

  async seek(positionMs: number): Promise<void> {
    await this.command({ type: 'seek', positionMs });
  }

  async seekBy(deltaMs: number): Promise<void> {
    const target = Math.min(
      Math.max(0, this.positionMs() + deltaMs),
      this.durationMs() || Number.MAX_SAFE_INTEGER,
    );
    await this.seek(target);
  }

  async next(): Promise<void> {
    await this.command({ type: 'skipNext' });
  }

  async previous(): Promise<void> {
    await this.command({ type: 'skipPrevious' });
  }

  async setRate(rate: number): Promise<void> {
    const clamped = Math.min(3, Math.max(0.5, rate));
    if (Math.abs(this.rate() - clamped) < 0.001) return;
    await this.command({ type: 'setRate', rate: clamped });
  }

  async enqueue(episodes: readonly PodcastEpisode[], position: 'end' | 'next' = 'end'): Promise<void> {
    if (episodes.length === 0) return;
    await this.command({ type: 'enqueue', trackIds: episodes.map((episode) => episode.id), position });
  }

  async removeEntry(entryId: string): Promise<void> {
    await this.command({ type: 'remove', entryId });
  }

  async clearQueue(): Promise<void> {
    await this.command({ type: 'clear' });
  }

  private handleEvent(event: PlaybackEvent): void {
    switch (event.type) {
      case 'stateChanged':
        if (event.snapshot.context !== 'podcast') break;
        this.stateRevision += 1;
        this.snapshot.set(event.snapshot);
        this.positionMs.set(event.snapshot.positionMs);
        this.durationMs.set(event.snapshot.durationMs);
        break;
      case 'positionChanged':
        if (!this.snapshot().active) break;
        this.positionRevision += 1;
        this.positionMs.set(event.positionMs);
        this.durationMs.update((current) => event.durationMs || current);
        break;
      case 'queueChanged':
        if (event.queue.context !== 'podcast') break;
        this.queueRevision += 1;
        this.queue.set(event.queue);
        break;
      case 'trackChanged':
        break;
      case 'error':
        this.lastError.set(event.error.message);
        break;
    }
  }
}
