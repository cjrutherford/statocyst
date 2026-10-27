import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type {
  CommandError,
  EngineCommand,
  EngineEvent,
  EngineLoadRequest,
  PlaybackCommand,
  PlaybackEvent,
  PlaybackSnapshot,
  PlaybackState,
  QueueSnapshot,
  Result,
  Track,
} from '@statocyst/contracts';
import { CHANNELS, fail, ok, validatePlaybackCommand } from '@statocyst/contracts';
import {
  advanceAfterEnd,
  applyQueueCommand,
  createQueue,
  currentEntry,
  defaultEntryId,
  type QueueContext,
  type QueueModel,
} from '@statocyst/playback-core';
import type { StatocystDatabase, StoredTrack } from '@statocyst/persistence';
import type { SettingsService } from './settings-service';
import type { Logger } from './logger';

export interface PlaybackServiceOptions {
  database: StatocystDatabase;
  settings: SettingsService;
  logger: Logger;
  getWindow: () => BrowserWindow | null;
}

function toTrack(stored: StoredTrack): Track {
  const {
    path: _path,
    pathKey: _pathKey,
    fileName: _fileName,
    ext: _ext,
    sizeBytes: _sizeBytes,
    mtimeMs: _mtimeMs,
    discNo: _discNo,
    genre: _genre,
    bitrate: _bitrate,
    sampleRate: _sampleRate,
    channels: _channels,
    codec: _codec,
    artworkPath: _artworkPath,
    addedAt: _addedAt,
    updatedAt: _updatedAt,
    lastPlayedAt: _lastPlayedAt,
    playCount: _playCount,
    sourceKind: _sourceKind,
    ...track
  } = stored;
  return track;
}

export class PlaybackService {
  private queue: QueueModel = createQueue();
  private tracks = new Map<string, StoredTrack>();
  private state: PlaybackState = 'idle';
  private positionMs = 0;
  private durationMs = 0;
  private volume = 0.85;
  private muted = false;
  private token = 0;
  private loadedEntryId: string | null = null;
  private serial: Promise<unknown> = Promise.resolve();
  private persistTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(private readonly options: PlaybackServiceOptions) {}

  private get database(): StatocystDatabase {
    return this.options.database;
  }

  async init(): Promise<void> {
    const [entries, playback, tracks, settings] = await Promise.all([
      this.database.loadQueue(),
      this.database.loadPlaybackState(),
      this.database.listTracks(),
      Promise.resolve(this.options.settings.get()),
    ]);
    this.tracks = new Map(tracks.map((track) => [track.id, track]));
    this.volume = settings.volume;
    this.muted = settings.muted;
    this.queue = {
      ...createQueue(),
      entries: entries.filter((entry) => this.tracks.has(entry.trackId)),
      currentEntryId: playback.currentEntryId,
      shuffle: playback.shuffle,
      repeat: playback.repeat,
    };
    if (this.queue.currentEntryId && !currentEntry(this.queue)) {
      this.queue.currentEntryId = this.queue.entries[0]?.entryId ?? null;
    }
    if (!this.queue.currentEntryId && this.queue.entries.length > 0) {
      this.queue.currentEntryId = this.queue.entries[0].entryId;
    }
    if (this.queue.shuffle) {
      // Rebuild the shuffle bag from the restored entries. History is not
      // restored across restarts, but the bag must be usable immediately.
      this.queue = applyQueueCommand(this.queue, { type: 'setShuffle', enabled: false }, this.context()).queue;
      this.queue = applyQueueCommand(this.queue, { type: 'setShuffle', enabled: true }, this.context()).queue;
    }
    const entry = currentEntry(this.queue);
    const track = entry ? this.tracks.get(entry.trackId) : null;
    this.durationMs = track?.durationMs ?? 0;
    this.positionMs = Math.min(playback.positionMs, this.durationMs || playback.positionMs);
    this.state = entry ? 'paused' : 'idle';
    this.options.logger.info('playback.initialised', {
      entries: this.queue.entries.length,
      state: this.state,
      positionMs: this.positionMs,
    });
  }

  async syncLibrary(reason: string): Promise<void> {
    const tracks = await this.database.listTracks();
    this.tracks = new Map(tracks.map((track) => [track.id, track]));
    const entries = await this.database.loadQueue();
    const kept = entries.filter((entry) => this.tracks.has(entry.trackId));
    const previousCurrent = this.queue.currentEntryId;
    this.queue.entries = kept;
    if (this.queue.currentEntryId && !kept.some((entry) => entry.entryId === this.queue.currentEntryId)) {
      this.queue.currentEntryId = kept[0]?.entryId ?? null;
      this.positionMs = 0;
    }
    if (!this.queue.currentEntryId && kept.length > 0) {
      this.queue.currentEntryId = kept[0].entryId;
    }
    if (kept.length === 0) {
      this.state = 'idle';
      this.positionMs = 0;
      this.durationMs = 0;
      this.loadedEntryId = null;
    } else if (previousCurrent !== this.queue.currentEntryId) {
      this.loadedEntryId = null;
    }
    this.options.logger.info('playback.library.synced', {
      reason,
      entries: kept.length,
      currentEntryId: this.queue.currentEntryId,
    });
    this.emitQueue();
    this.emitState();
    this.schedulePersist();
  }

  getSnapshot(): PlaybackSnapshot {
    const entry = currentEntry(this.queue);
    const track = entry ? this.tracks.get(entry.trackId) : null;
    return {
      state: this.state,
      currentEntryId: this.queue.currentEntryId,
      positionMs: Math.round(this.positionMs),
      durationMs: Math.round(this.durationMs || track?.durationMs || 0),
      volume: this.volume,
      muted: this.muted,
      shuffle: this.queue.shuffle,
      repeat: this.queue.repeat,
      track: track ? toTrack(track) : null,
    };
  }

  getQueue(): QueueSnapshot {
    return {
      entries: this.queue.entries.flatMap((entry) => {
        const track = this.tracks.get(entry.trackId);
        return track ? [{ entryId: entry.entryId, trackId: entry.trackId, track: toTrack(track) }] : [];
      }),
      currentEntryId: this.queue.currentEntryId,
      shuffle: this.queue.shuffle,
      repeat: this.queue.repeat,
    };
  }

  command(input: unknown): Promise<Result<PlaybackSnapshot>> {
    const validated = validatePlaybackCommand(input);
    if (!validated.ok) return Promise.resolve(validated);
    const run = this.serial.then(() => this.applyCommand(validated.value));
    this.serial = run.catch(() => undefined);
    return run;
  }

  engineEvent(event: unknown): void {
    if (!event || typeof event !== 'object') return;
    const typed = event as EngineEvent;
    if (typeof typed.token !== 'number' || typed.token !== this.token) return;

    switch (typed.type) {
      case 'ready': {
        if (Number.isFinite(typed.durationMs) && typed.durationMs > 0) {
          this.durationMs = typed.durationMs;
        }
        this.emitPosition();
        break;
      }
      case 'state': {
        if (typed.state === 'playing') {
          this.state = 'playing';
        } else if (typed.state === 'paused') {
          this.state = 'paused';
        } else {
          this.state = 'buffering';
        }
        this.emitState();
        if (this.state === 'paused') this.schedulePersist();
        break;
      }
      case 'time': {
        this.positionMs = Math.max(0, Number(typed.positionMs) || 0);
        if (Number.isFinite(typed.durationMs) && typed.durationMs > 0) {
          this.durationMs = typed.durationMs;
        }
        this.emitPosition();
        this.schedulePersist();
        break;
      }
      case 'ended': {
        void this.handleEnded();
        break;
      }
      case 'error': {
        this.state = 'error';
        this.options.logger.error('playback.engine.error', {
          code: typed.code,
          message: typed.message,
          trackId: currentEntry(this.queue)?.trackId,
        });
        this.emitState();
        this.emit({
          type: 'error',
          error: {
            code: typed.code === 'UNSUPPORTED_MEDIA' ? 'UNSUPPORTED_MEDIA' : 'MEDIA_UNAVAILABLE',
            message: typed.message || 'The audio engine could not play this file',
          },
        });
        this.schedulePersist();
        break;
      }
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persistNow();
    this.sendCommand({ token: this.token, action: 'pause' });
    await this.serial.catch(() => undefined);
  }

  private context(): QueueContext {
    return {
      isKnownTrack: (trackId) => this.tracks.has(trackId),
      createEntryId: () => `q_${randomUUID()}`,
    };
  }

  private async applyCommand(command: PlaybackCommand): Promise<Result<PlaybackSnapshot>> {
    const entryBefore = this.queue.currentEntryId;
    const wasPlaying = this.state === 'playing' || this.state === 'buffering';

    if (command.type === 'pause') {
      this.sendCommand({ token: this.token, action: 'pause' });
      this.state = this.queue.currentEntryId ? 'paused' : 'idle';
      await this.persistNow();
      this.emitState();
      return ok(this.getSnapshot());
    }

    if (command.type === 'seek') {
      const max = this.durationMs || this.getSnapshot().durationMs;
      this.positionMs = Math.max(0, Math.min(command.positionMs, max || command.positionMs));
      this.sendCommand({ token: this.token, action: 'seek', positionMs: this.positionMs });
      this.emitPosition();
      this.schedulePersist();
      return ok(this.getSnapshot());
    }

    if (command.type === 'setVolume') {
      this.volume = command.volume;
      this.sendCommand({ token: this.token, action: 'volume', volume: this.volume, muted: this.muted });
      await this.options.settings.update({ volume: this.volume });
      this.emitState();
      return ok(this.getSnapshot());
    }

    if (command.type === 'setMuted') {
      this.muted = command.muted;
      this.sendCommand({ token: this.token, action: 'volume', volume: this.volume, muted: this.muted });
      await this.options.settings.update({ muted: this.muted });
      this.emitState();
      return ok(this.getSnapshot());
    }

    if (command.type === 'play' && !command.trackId && this.queue.currentEntryId) {
      const current = currentEntry(this.queue);
      if (!current) return fail('NO_CURRENT_TRACK', 'The queue has no current entry');
      if (this.loadedEntryId === current.entryId) {
        this.sendCommand({ token: this.token, action: 'play' });
        this.state = 'buffering';
        this.emitState();
        return ok(this.getSnapshot());
      }
      await this.loadEntry(current.entryId, true, this.positionMs);
      return ok(this.getSnapshot());
    }

    if (
      command.type === 'playEntry' &&
      command.entryId === this.queue.currentEntryId &&
      this.state !== 'playing' &&
      this.state !== 'buffering'
    ) {
      if (this.loadedEntryId === command.entryId) {
        this.sendCommand({ token: this.token, action: 'play' });
        this.state = 'buffering';
        this.emitState();
      } else {
        await this.loadEntry(command.entryId, true, this.positionMs);
      }
      return ok(this.getSnapshot());
    }

    const outcome = applyQueueCommand(this.queue, command, this.context());
    if (outcome.error) {
      return fail(outcome.error.code, outcome.error.message);
    }
    this.queue = outcome.queue;

    if (outcome.queueChanged) {
      await this.persistQueue();
      this.emitQueue();
    }
    if (outcome.shuffleChanged || outcome.repeatChanged) {
      this.schedulePersist();
    }

    if (outcome.selection) {
      const { reason, entryId } = outcome.selection;
      if (reason === 'none' || !entryId) {
        this.stopEngine();
        this.state = this.queue.entries.length > 0 ? 'ended' : 'idle';
        this.positionMs = 0;
        this.durationMs = 0;
        this.emitState();
        this.emitPosition();
        await this.persistNow();
      } else {
        const explicitStart =
          command.type === 'play' ||
          command.type === 'playEntry' ||
          command.type === 'skipNext' ||
          command.type === 'skipPrevious';
        const autoplay = explicitStart || (command.type === 'remove' && wasPlaying);
        const startPosition = reason === 'restart' ? 0 : entryId === entryBefore ? this.positionMs : 0;
        await this.loadEntry(entryId, autoplay, startPosition);
      }
    } else if (outcome.queueChanged) {
      this.emitState();
      this.schedulePersist();
    }

    if (!outcome.selection && outcome.queueChanged && this.queue.currentEntryId === null) {
      this.state = 'idle';
    }

    return ok(this.getSnapshot());
  }

  private async loadEntry(entryId: string, autoplay: boolean, startPositionMs = 0): Promise<void> {
    const entry = this.queue.entries.find((candidate) => candidate.entryId === entryId);
    if (!entry) {
      this.state = 'error';
      this.emitState();
      return;
    }
    const track = this.tracks.get(entry.trackId);
    this.queue.currentEntryId = entryId;
    if (!track) {
      this.state = 'error';
      this.emitState();
      this.emit({
        type: 'error',
        error: { code: 'TRACK_NOT_FOUND', message: 'The selected track is no longer in the library' },
      });
      return;
    }
    this.token += 1;
    this.loadedEntryId = entryId;
    this.durationMs = track.durationMs;
    this.positionMs = Math.max(0, Math.min(startPositionMs, track.durationMs || startPositionMs));
    this.state = autoplay ? 'buffering' : 'paused';
    const request: EngineLoadRequest = {
      token: this.token,
      entryId,
      trackId: track.id,
      url: `statocyst-media://track/${track.id}`,
      autoplay,
      startPositionMs: this.positionMs,
      durationMs: this.durationMs,
      volume: this.volume,
      muted: this.muted,
    };
    this.send(CHANNELS.engineLoad, request);
    this.options.logger.info('playback.track.load', {
      trackId: track.id,
      entryId,
      autoplay,
      positionMs: this.positionMs,
    });
    this.emit({ type: 'trackChanged', entry: { entryId, trackId: track.id, track: toTrack(track) } });
    this.emitState();
    this.emitPosition();
    this.schedulePersist();
    if (autoplay) {
      void this.database.markPlayed(track.id).catch((error) => {
        this.options.logger.warn('playback.mark-played.failed', { error, trackId: track.id });
      });
    }
  }

  private async handleEnded(): Promise<void> {
    const outcome = advanceAfterEnd(this.queue, this.context());
    if (outcome.error) {
      this.state = 'ended';
      this.emitState();
      return;
    }
    this.queue = outcome.queue;
    if (outcome.selection?.entryId && outcome.selection.reason !== 'none') {
      await this.loadEntry(outcome.selection.entryId, true, 0);
    } else {
      this.state = 'ended';
      this.positionMs = this.durationMs;
      this.emitState();
      this.emitPosition();
      this.schedulePersist();
    }
  }

  private stopEngine(): void {
    this.loadedEntryId = null;
    this.sendCommand({ token: this.token, action: 'pause' });
    this.sendCommand({ token: this.token, action: 'seek', positionMs: 0 });
  }

  private send(channel: string, payload: unknown): void {
    const window = this.options.getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send(channel, payload);
  }

  private sendCommand(command: EngineCommand): void {
    this.send(CHANNELS.engineCommand, command);
  }

  private emit(event: PlaybackEvent): void {
    this.send(CHANNELS.playbackEvent, event);
  }

  private emitState(): void {
    this.emit({ type: 'stateChanged', snapshot: this.getSnapshot() });
  }

  private emitPosition(): void {
    this.emit({
      type: 'positionChanged',
      positionMs: Math.round(this.positionMs),
      durationMs: Math.round(this.durationMs),
    });
  }

  private emitQueue(): void {
    this.emit({ type: 'queueChanged', queue: this.getQueue() });
  }

  private async persistQueue(): Promise<void> {
    try {
      await this.database.saveQueue(
        this.queue.entries.map((entry) => ({ entryId: entry.entryId, trackId: entry.trackId })),
      );
    } catch (error) {
      this.options.logger.error('playback.queue.persist.failed', { error });
    }
  }

  private schedulePersist(): void {
    if (this.shuttingDown) return;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, 750);
  }

  private async persistNow(): Promise<void> {
    try {
      await this.database.savePlaybackState({
        currentEntryId: this.queue.currentEntryId,
        positionMs: this.positionMs,
        shuffle: this.queue.shuffle,
        repeat: this.queue.repeat,
      });
    } catch (error) {
      this.options.logger.error('playback.state.persist.failed', { error });
    }
  }

  // Exposed for diagnostics and integration tests.
  async currentTrack(): Promise<Track | null> {
    const entry = currentEntry(this.queue);
    if (!entry) return null;
    const track = await this.options.database.getTrack(entry.trackId).catch(() => null);
    return track ? toTrack(track) : null;
  }

  asError(error: unknown): CommandError {
    return {
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unexpected playback failure',
    };
  }
}
