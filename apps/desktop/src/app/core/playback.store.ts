import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import type {
  PlaybackCommand,
  PlaybackEvent,
  PlaybackSnapshot,
  QueueSnapshot,
  RepeatMode,
  Result,
  Track,
} from '@statocyst/contracts';
import { bridge } from './bridge';
import { ToastStore } from './toast.store';

const EMPTY_SNAPSHOT: PlaybackSnapshot = {
  state: 'idle',
  currentEntryId: null,
  positionMs: 0,
  durationMs: 0,
  volume: 0.85,
  muted: false,
  shuffle: false,
  repeat: 'off',
  track: null,
};

const EMPTY_QUEUE: QueueSnapshot = {
  entries: [],
  currentEntryId: null,
  shuffle: false,
  repeat: 'off',
};

const QUEUE_COMMANDS = new Set<PlaybackCommand['type']>([
  'play',
  'playEntry',
  'skipNext',
  'skipPrevious',
  'enqueue',
  'playNext',
  'remove',
  'reorder',
  'setShuffle',
  'setRepeat',
  'clear',
]);

@Injectable({ providedIn: 'root' })
export class PlaybackStore {
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(ToastStore);
  private initialised = false;

  readonly snapshot = signal<PlaybackSnapshot>({ ...EMPTY_SNAPSHOT });
  readonly queue = signal<QueueSnapshot>({ ...EMPTY_QUEUE });
  readonly ready = signal(false);
  readonly lastError = signal<string | null>(null);

  readonly track = computed<Track | null>(() => this.snapshot().track);
  readonly isPlaying = computed(() => {
    const state = this.snapshot().state;
    return state === 'playing' || state === 'buffering';
  });
  readonly progress = computed(() => {
    const { positionMs, durationMs } = this.snapshot();
    if (durationMs <= 0) return 0;
    return Math.min(1, Math.max(0, positionMs / durationMs));
  });
  readonly currentIndex = computed(() => {
    const { entries, currentEntryId } = this.queue();
    if (!currentEntryId) return -1;
    return entries.findIndex((entry) => entry.entryId === currentEntryId);
  });
  readonly upNext = computed(() => {
    const queue = this.queue();
    const index = this.currentIndex();
    if (index < 0) return queue.entries.slice(0, 3);
    return queue.entries.slice(index + 1, index + 4);
  });
  readonly totalDurationMs = computed(() =>
    this.queue().entries.reduce((sum, entry) => sum + entry.track.durationMs, 0),
  );

  async init(): Promise<void> {
    if (this.initialised) return;
    this.initialised = true;
    const api = bridge();
    const unsubscribe = api.playback.onEvent((event) => this.handleEvent(event));
    this.destroyRef.onDestroy(unsubscribe);
    try {
      const [snapshot, queue] = await Promise.all([
        api.playback.getSnapshot(),
        api.playback.getQueue(),
      ]);
      this.snapshot.set(snapshot);
      this.queue.set(queue);
      this.ready.set(true);
    } catch (error) {
      this.toasts.error('Playback state unavailable', String(error));
    }
  }

  async command(command: PlaybackCommand): Promise<Result<PlaybackSnapshot>> {
    let result: Result<PlaybackSnapshot>;
    try {
      result = await bridge().playback.command(command);
    } catch (error) {
      result = { ok: false, error: { code: 'INTERNAL_ERROR', message: String(error) } };
    }
    if (!result.ok) {
      this.lastError.set(result.error.message);
      this.toasts.error(result.error.message, result.error.code);
      return result;
    }
    this.snapshot.set(result.value);
    this.lastError.set(null);
    if (QUEUE_COMMANDS.has(command.type)) {
      const queue = await bridge().playback.getQueue().catch(() => null);
      if (queue) this.queue.set(queue);
    }
    return result;
  }

  async playTrack(trackId: string): Promise<void> {
    await this.command({ type: 'play', trackId });
  }

  async playEntry(entryId: string): Promise<void> {
    await this.command({ type: 'playEntry', entryId });
  }

  async toggle(): Promise<void> {
    const snapshot = this.snapshot();
    if (snapshot.state === 'playing' || snapshot.state === 'buffering') {
      await this.command({ type: 'pause' });
      return;
    }
    if (snapshot.state === 'ended' && snapshot.currentEntryId) {
      await this.command({ type: 'seek', positionMs: 0 });
    }
    if (snapshot.currentEntryId) {
      await this.command({ type: 'playEntry', entryId: snapshot.currentEntryId });
      return;
    }
    await this.command({ type: 'play' });
  }

  async seek(positionMs: number): Promise<void> {
    await this.command({ type: 'seek', positionMs });
  }

  async seekBy(deltaMs: number): Promise<void> {
    const { positionMs, durationMs } = this.snapshot();
    const target = Math.min(Math.max(0, positionMs + deltaMs), durationMs || Number.MAX_SAFE_INTEGER);
    await this.seek(target);
  }

  async next(): Promise<void> {
    await this.command({ type: 'skipNext' });
  }

  async previous(): Promise<void> {
    await this.command({ type: 'skipPrevious' });
  }

  async setVolume(volume: number): Promise<void> {
    await this.command({ type: 'setVolume', volume: Math.min(1, Math.max(0, volume)) });
  }

  async toggleMute(): Promise<void> {
    await this.command({ type: 'setMuted', muted: !this.snapshot().muted });
  }

  async toggleShuffle(): Promise<void> {
    await this.command({ type: 'setShuffle', enabled: !this.snapshot().shuffle });
  }

  async cycleRepeat(): Promise<void> {
    const current = this.snapshot().repeat;
    const next: RepeatMode = current === 'off' ? 'all' : current === 'all' ? 'one' : 'off';
    await this.command({ type: 'setRepeat', mode: next });
  }

  async enqueue(trackIds: string[], position: 'end' | 'next' = 'end'): Promise<void> {
    if (trackIds.length === 0) return;
    const result = await this.command({ type: 'enqueue', trackIds, position });
    if (result.ok) {
      this.toasts.success(
        position === 'next' ? 'Queued to play next' : 'Added to queue',
        `${trackIds.length} track${trackIds.length === 1 ? '' : 's'}`,
      );
    }
  }

  async playNext(trackId: string): Promise<void> {
    const result = await this.command({ type: 'playNext', trackId });
    if (result.ok) this.toasts.success('Playing next', this.trackTitle(trackId));
  }

  async removeEntry(entryId: string): Promise<void> {
    await this.command({ type: 'remove', entryId });
  }

  async moveEntry(entryId: string, toIndex: number): Promise<void> {
    await this.command({ type: 'reorder', entryId, toIndex });
  }

  async clearQueue(): Promise<void> {
    await this.command({ type: 'clear' });
  }

  private trackTitle(trackId: string): string {
    return this.queue().entries.find((entry) => entry.trackId === trackId)?.track.title ?? 'Track';
  }

  private handleEvent(event: PlaybackEvent): void {
    switch (event.type) {
      case 'stateChanged':
        this.snapshot.set(event.snapshot);
        break;
      case 'positionChanged':
        this.snapshot.update((snapshot) => ({
          ...snapshot,
          positionMs: event.positionMs,
          durationMs: event.durationMs || snapshot.durationMs,
        }));
        break;
      case 'queueChanged':
        this.queue.set(event.queue);
        break;
      case 'trackChanged':
        break;
      case 'error':
        this.lastError.set(event.error.message);
        this.toasts.error(event.error.message, event.error.code);
        break;
    }
  }
}
