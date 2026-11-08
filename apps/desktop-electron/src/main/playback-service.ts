import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type {
  CommandError,
  EngineCommand,
  EngineEvent,
  EngineLoadRequest,
  PlaybackCommand,
  PlaybackContext,
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
  /** Invoked after the authoritative track changes (used for cache lookahead). */
  onTrackChanged?: (currentTrackId: string, nextTrackId: string | null) => void;
}

function toTrack(stored: StoredTrack): Track {
  const {
    path: _path,
    pathKey: _pathKey,
    fileName: _fileName,
    ext: _ext,
    mtimeMs: _mtimeMs,
    discNo: _discNo,
    genre: _genre,
    sampleRate: _sampleRate,
    channels: _channels,
    codec: _codec,
    artworkPath: _artworkPath,
    addedAt: _addedAt,
    updatedAt: _updatedAt,
    lastPlayedAt: _lastPlayedAt,
    playCount: _playCount,
    ...track
  } = stored;
  return track;
}

interface ContextState {
  queue: QueueModel;
  state: PlaybackState;
  positionMs: number;
  durationMs: number;
  loadedEntryId: string | null;
}

function emptyContext(): ContextState {
  return {
    queue: createQueue(),
    state: 'idle',
    positionMs: 0,
    durationMs: 0,
    loadedEntryId: null,
  };
}

const QUEUE_ONLY_COMMANDS: ReadonlySet<PlaybackCommand['type']> = new Set([
  'enqueue',
  'playNext',
  'remove',
  'reorder',
  'setShuffle',
  'setRepeat',
  'clear',
]);

export class PlaybackService {
  private contexts: Record<PlaybackContext, ContextState> = {
    music: emptyContext(),
    podcast: emptyContext(),
  };
  private activeContext: PlaybackContext = 'music';
  private podcastSpeed = 1;
  private tracks = new Map<string, StoredTrack>();
  private bufferSeconds = 0;
  private volume = 0.85;
  private muted = false;
  private token = 0;
  private serial: Promise<unknown> = Promise.resolve();
  private persistTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(private readonly options: PlaybackServiceOptions) {}

  private get database(): StatocystDatabase {
    return this.options.database;
  }

  private get active(): ContextState {
    return this.contexts[this.activeContext];
  }

  private get queue(): QueueModel {
    return this.active.queue;
  }

  private set queue(value: QueueModel) {
    this.active.queue = value;
  }

  private get state(): PlaybackState {
    return this.active.state;
  }

  private set state(value: PlaybackState) {
    this.active.state = value;
  }

  private get positionMs(): number {
    return this.active.positionMs;
  }

  private set positionMs(value: number) {
    this.active.positionMs = value;
  }

  private get durationMs(): number {
    return this.active.durationMs;
  }

  private set durationMs(value: number) {
    this.active.durationMs = value;
  }

  private get loadedEntryId(): string | null {
    return this.active.loadedEntryId;
  }

  private set loadedEntryId(value: string | null) {
    this.active.loadedEntryId = value;
  }

  async init(): Promise<void> {
    const [musicEntries, musicPlayback, podcastEntries, podcastPlayback, tracks, settings] =
      await Promise.all([
        this.database.loadQueue(),
        this.database.loadPlaybackState(),
        this.loadPodcastPlaybackEntries(),
        this.database.loadPodcastPlaybackState(),
        this.database.listAllTracks(),
        Promise.resolve(this.options.settings.get()),
      ]);
    this.tracks = new Map(tracks.map((track) => [track.id, track]));
    this.volume = settings.volume;
    this.muted = settings.muted;
    this.activeContext = musicPlayback.activeContext;
    this.podcastSpeed = podcastPlayback.speed;

    let musicQueue: QueueModel = {
      ...createQueue(),
      entries: musicEntries.filter((entry) => this.trackFits('music', entry.trackId)),
      currentEntryId: musicPlayback.currentEntryId,
      shuffle: musicPlayback.shuffle,
      repeat: musicPlayback.repeat,
    };
    musicQueue = this.restoreCurrent(musicQueue);
    if (musicQueue.shuffle) {
      // Rebuild the shuffle bag from the restored entries. History is not
      // restored across restarts, but the bag must be usable immediately.
      musicQueue = applyQueueCommand(
        musicQueue,
        { type: 'setShuffle', enabled: false },
        this.context('music'),
      ).queue;
      musicQueue = applyQueueCommand(
        musicQueue,
        { type: 'setShuffle', enabled: true },
        this.context('music'),
      ).queue;
    }
    const podcastQueue = this.restoreCurrent({
      ...createQueue(),
      entries: podcastEntries.filter((entry) => this.trackFits('podcast', entry.trackId)),
      currentEntryId: podcastPlayback.currentEntryId,
    });
    this.contexts = {
      music: this.contextFromQueue(musicQueue, musicPlayback.positionMs),
      podcast: this.contextFromQueue(podcastQueue, podcastPlayback.positionMs),
    };
    this.options.logger.info('playback.initialised', {
      activeContext: this.activeContext,
      musicEntries: this.contexts.music.queue.entries.length,
      podcastEntries: this.contexts.podcast.queue.entries.length,
      state: this.state,
      positionMs: this.positionMs,
    });
  }

  async syncLibrary(reason: string): Promise<void> {
    const tracks = await this.database.listAllTracks();
    this.tracks = new Map(tracks.map((track) => [track.id, track]));
    const [musicEntries, podcastEntries] = await Promise.all([
      this.database.loadQueue(),
      this.loadPodcastPlaybackEntries(),
    ]);
    this.syncContext('music', musicEntries);
    this.syncContext('podcast', podcastEntries);
    this.options.logger.info('playback.library.synced', {
      reason,
      activeContext: this.activeContext,
      musicEntries: this.contexts.music.queue.entries.length,
      podcastEntries: this.contexts.podcast.queue.entries.length,
    });
    this.emitQueue('music');
    this.emitQueue('podcast');
    this.emitState();
    this.schedulePersist();
  }

  private async loadPodcastPlaybackEntries(): Promise<
    Array<{ entryId: string; trackId: string }>
  > {
    const entries = await this.database.loadPodcastQueue();
    const episodes = await Promise.all(
      entries.map((entry) =>
        this.database.getPodcastEpisode(entry.episodeId).catch(() => null),
      ),
    );
    return entries.flatMap((entry, index) => {
      const episode = episodes[index];
      return episode ? [{ entryId: entry.entryId, trackId: episode.id }] : [];
    });
  }

  private trackFits(context: PlaybackContext, trackId: string): boolean {
    const track = this.tracks.get(trackId);
    if (!track) return false;
    return context === 'music' ? track.mediaKind === 'music' : track.mediaKind === 'podcast';
  }

  private restoreCurrent(queue: QueueModel): QueueModel {
    if (queue.currentEntryId && !queue.entries.some((entry) => entry.entryId === queue.currentEntryId)) {
      queue.currentEntryId = queue.entries[0]?.entryId ?? null;
    }
    if (!queue.currentEntryId && queue.entries.length > 0) {
      queue.currentEntryId = queue.entries[0].entryId;
    }
    return queue;
  }

  private contextFromQueue(queue: QueueModel, positionMs: number): ContextState {
    const entry = currentEntry(queue);
    const track = entry ? this.tracks.get(entry.trackId) : null;
    const durationMs = track?.durationMs ?? 0;
    return {
      queue,
      state: entry ? 'paused' : 'idle',
      positionMs: Math.min(Math.max(0, positionMs), durationMs || Math.max(0, positionMs)),
      durationMs,
      loadedEntryId: null,
    };
  }

  private syncContext(context: PlaybackContext, entries: readonly { entryId: string; trackId: string }[]): void {
    const state = this.contexts[context];
    const kept = entries.filter((entry) => this.trackFits(context, entry.trackId));
    const previousCurrent = state.queue.currentEntryId;
    state.queue.entries = kept.map((entry) => ({ ...entry }));
    if (state.queue.currentEntryId && !kept.some((entry) => entry.entryId === state.queue.currentEntryId)) {
      state.queue.currentEntryId = kept[0]?.entryId ?? null;
      state.positionMs = 0;
    }
    if (!state.queue.currentEntryId && kept.length > 0) {
      state.queue.currentEntryId = kept[0].entryId;
    }
    if (kept.length === 0) {
      state.state = 'idle';
      state.positionMs = 0;
      state.durationMs = 0;
      state.loadedEntryId = null;
    } else if (previousCurrent !== state.queue.currentEntryId) {
      state.loadedEntryId = null;
      state.positionMs = 0;
      state.durationMs = 0;
    }
  }

  getSnapshot(context: PlaybackContext = this.activeContext): PlaybackSnapshot {
    const state = this.contexts[context];
    const entry = currentEntry(state.queue);
    const track = entry ? this.tracks.get(entry.trackId) : null;
    return {
      state:
        context === this.activeContext
          ? state.state
          : state.queue.currentEntryId
            ? 'paused'
            : 'idle',
      currentEntryId: state.queue.currentEntryId,
      positionMs: Math.round(state.positionMs),
      durationMs: Math.round(state.durationMs || track?.durationMs || 0),
      volume: this.volume,
      muted: this.muted,
      shuffle: state.queue.shuffle,
      repeat: state.queue.repeat,
      rate: context === 'podcast' ? this.podcastSpeed : 1,
      context,
      active: context === this.activeContext,
      track: track ? toTrack(track) : null,
    };
  }

  getQueue(context: PlaybackContext = this.activeContext): QueueSnapshot {
    const state = this.contexts[context];
    return {
      entries: state.queue.entries.flatMap((entry) => {
        const track = this.tracks.get(entry.trackId);
        return track
          ? [{ entryId: entry.entryId, trackId: entry.trackId, track: toTrack(track) }]
          : [];
      }),
      currentEntryId: state.queue.currentEntryId,
      shuffle: state.queue.shuffle,
      repeat: state.queue.repeat,
      context,
      active: context === this.activeContext,
    };
  }

  command(
    input: unknown,
    context: PlaybackContext = 'music',
  ): Promise<Result<PlaybackSnapshot>> {
    const validated = validatePlaybackCommand(input);
    if (!validated.ok) return Promise.resolve(validated);
    const run = this.serial.then(() => this.routeCommand(validated.value, context));
    this.serial = run.catch(() => undefined);
    return run;
  }

  private async routeCommand(
    command: PlaybackCommand,
    target: PlaybackContext,
  ): Promise<Result<PlaybackSnapshot>> {
    if (command.type === 'setVolume' || command.type === 'setMuted') {
      return this.applyCommand(command);
    }
    if (target !== this.activeContext) {
      if (QUEUE_ONLY_COMMANDS.has(command.type)) {
        return this.applyInactiveQueueCommand(target, command);
      }
      if (command.type === 'pause') {
        return ok(this.getSnapshot(target));
      }
      await this.switchContext(target);
    }
    return this.applyCommand(command);
  }

  private async applyInactiveQueueCommand(
    context: PlaybackContext,
    command: PlaybackCommand,
  ): Promise<Result<PlaybackSnapshot>> {
    const state = this.contexts[context];
    const outcome = applyQueueCommand(state.queue, command, this.context(context));
    if (outcome.error) return fail(outcome.error.code, outcome.error.message);
    state.queue = outcome.queue;
    if (outcome.queueChanged) {
      await this.persistQueue(context);
      this.emitQueue(context);
    }
    if (outcome.shuffleChanged || outcome.repeatChanged) {
      await this.persistState(context);
    }
    return ok(this.getSnapshot(context));
  }

  private async switchContext(target: PlaybackContext): Promise<void> {
    if (target === this.activeContext) return;
    const outgoing = this.activeContext;
    this.sendCommand({ token: this.token, action: 'pause' });
    this.contexts[outgoing].state = this.contexts[outgoing].queue.currentEntryId
      ? 'paused'
      : 'idle';
    this.activeContext = target;
    await this.persistState(outgoing);
    await this.persistNow();
    this.emitState(outgoing);
    this.emitQueue(outgoing);
    this.emitState();
    this.emitQueue(target);
    const entry = currentEntry(this.queue);
    if (entry) {
      await this.loadEntry(entry.entryId, false, this.positionMs);
    } else {
      this.state = 'idle';
      this.emitState();
      this.emitPosition();
    }
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
      case 'health': {
        if (Number.isFinite(typed.bufferSeconds)) {
          this.bufferSeconds = Math.max(0, typed.bufferSeconds);
        }
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

  private context(context: PlaybackContext = this.activeContext): QueueContext {
    return {
      isKnownTrack: (trackId) => this.trackFits(context, trackId),
      createEntryId: () => `q_${randomUUID()}`,
    };
  }

  private async ensureTrack(trackId: string): Promise<void> {
    if (this.tracks.has(trackId)) return;
    const stored = await this.options.database.getTrack(trackId).catch(() => null);
    if (stored) this.tracks.set(stored.id, stored);
  }

  private async applyCommand(command: PlaybackCommand): Promise<Result<PlaybackSnapshot>> {
    if (command.type === 'play' && command.trackId) {
      await this.ensureTrack(command.trackId);
      if (command.contextTrackIds) {
        await Promise.all(command.contextTrackIds.map((id) => this.ensureTrack(id)));
      }
    }
    if (command.type === 'playEntry') {
      const entry = this.queue.entries.find((candidate) => candidate.entryId === command.entryId);
      if (entry) await this.ensureTrack(entry.trackId);
    }
    if (command.type === 'enqueue' || command.type === 'playNext') {
      const ids = command.type === 'enqueue' ? command.trackIds : [command.trackId];
      await Promise.all(ids.map((id) => this.ensureTrack(id)));
    }
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

    if (command.type === 'setRate') {
      if (this.activeContext !== 'podcast') {
        return fail('INVALID_ARGUMENT', 'Playback rate applies to podcasts');
      }
      this.podcastSpeed = Math.min(3, Math.max(0.5, command.rate));
      this.sendCommand({ token: this.token, action: 'rate', rate: this.podcastSpeed });
      await this.persistNow();
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
        let startPosition =
          reason === 'restart' ? 0 : entryId === entryBefore ? this.positionMs : 0;
        if (this.activeContext === 'podcast' && reason !== 'restart' && entryId !== entryBefore) {
          const resume = await this.podcastResumeForEntry(entryId);
          if (resume !== null) startPosition = resume;
        }
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
    let track = this.tracks.get(entry.trackId);
    if (!track) {
      const stored = await this.options.database.getTrack(entry.trackId).catch(() => null);
      if (stored) {
        this.tracks.set(stored.id, stored);
        track = stored;
      }
    }
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
      playbackRate: this.activeContext === 'podcast' ? this.podcastSpeed : 1,
    };
    this.send(CHANNELS.engineLoad, request);
    this.options.logger.info('playback.track.load', {
      trackId: track.id,
      entryId,
      autoplay,
      positionMs: this.positionMs,
    });
    this.emit({ type: 'trackChanged', entry: { entryId, trackId: track.id, track: toTrack(track) } });
    const nextIndex = this.queue.entries.findIndex((candidate) => candidate.entryId === entryId) + 1;
    const nextTrackId = nextIndex < this.queue.entries.length ? this.queue.entries[nextIndex].trackId : null;
    this.options.onTrackChanged?.(track.id, nextTrackId);
    this.emitState();
    this.emitPosition();
    this.schedulePersist();
    if (autoplay) {
      // Local listening history is opt-in (ADR-015). When disabled, playback is
      // unchanged but no play count or last-played timestamp is written.
      if (this.options.settings.get().listeningHistory) {
        if (this.activeContext === 'podcast') {
          void this.database
            .getPodcastEpisodeByMediaItemId(track.id)
            .then((episode) =>
              episode ? this.database.markPodcastEpisodeStarted(episode.episodeId) : undefined,
            )
            .catch((error) => {
              this.options.logger.warn('playback.podcast.mark-started.failed', {
                error,
                trackId: track.id,
              });
            });
        } else {
          void this.database.markPlayed(track.id).catch((error) => {
            this.options.logger.warn('playback.mark-played.failed', { error, trackId: track.id });
          });
        }
      }
    }
  }

  private async podcastResumeForEntry(entryId: string): Promise<number | null> {
    const entry = this.queue.entries.find((candidate) => candidate.entryId === entryId);
    if (!entry) return null;
    const episode = await this.database
      .getPodcastEpisodeByMediaItemId(entry.trackId)
      .catch(() => null);
    if (!episode) return null;
    return episode.completed ? 0 : episode.resumePositionMs;
  }

  private async handleEnded(): Promise<void> {
    if (this.activeContext === 'podcast') {
      const current = currentEntry(this.queue);
      const episode = current
        ? await this.database
            .getPodcastEpisodeByMediaItemId(current.trackId)
            .catch(() => null)
        : null;
      if (episode) {
        await this.database.setPodcastEpisodePlayed(episode.episodeId, true).catch((error) => {
          this.options.logger.warn('playback.podcast.complete.failed', { error });
        });
      }
    }
    const outcome = advanceAfterEnd(this.queue, this.context());
    if (outcome.error) {
      this.state = 'ended';
      this.emitState();
      return;
    }
    this.queue = outcome.queue;
    if (outcome.selection?.entryId && outcome.selection.reason !== 'none') {
      let startPosition = 0;
      if (this.activeContext === 'podcast') {
        const resume = await this.podcastResumeForEntry(outcome.selection.entryId);
        if (resume !== null) startPosition = resume;
      }
      await this.loadEntry(outcome.selection.entryId, true, startPosition);
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

  private emitState(context: PlaybackContext = this.activeContext): void {
    this.emit({ type: 'stateChanged', snapshot: this.getSnapshot(context) });
  }

  private emitPosition(): void {
    this.emit({
      type: 'positionChanged',
      positionMs: Math.round(this.positionMs),
      durationMs: Math.round(this.durationMs),
    });
  }

  private emitQueue(context: PlaybackContext = this.activeContext): void {
    this.emit({ type: 'queueChanged', queue: this.getQueue(context) });
  }

  private async persistQueue(context: PlaybackContext = this.activeContext): Promise<void> {
    try {
      const state = this.contexts[context];
      const entries = state.queue.entries.map((entry) => ({
        entryId: entry.entryId,
        trackId: entry.trackId,
      }));
      if (context === 'music') {
        await this.database.saveQueue(entries);
      } else {
        const episodes = await Promise.all(
          entries.map((entry) =>
            this.database
              .getPodcastEpisodeByMediaItemId(entry.trackId)
              .catch(() => null),
          ),
        );
        await this.database.savePodcastQueue(
          entries.flatMap((entry, index) => {
            const episode = episodes[index];
            return episode
              ? [{ entryId: entry.entryId, episodeId: episode.episodeId }]
              : [];
          }),
        );
      }
    } catch (error) {
      this.options.logger.error('playback.queue.persist.failed', { context, error });
    }
  }

  private async persistState(context: PlaybackContext = this.activeContext): Promise<void> {
    const state = this.contexts[context];
    try {
      if (context === 'music') {
        await this.database.savePlaybackState({
          currentEntryId: state.queue.currentEntryId,
          positionMs: state.positionMs,
          shuffle: state.queue.shuffle,
          repeat: state.queue.repeat,
          activeContext: this.activeContext,
        });
      } else {
        await this.database.savePodcastPlaybackState({
          currentEntryId: state.queue.currentEntryId,
          positionMs: state.positionMs,
          speed: this.podcastSpeed,
        });
      }
    } catch (error) {
      this.options.logger.error('playback.state.persist.failed', { context, error });
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
    await this.persistState('music');
    await this.persistState('podcast');
    const podcast = this.contexts.podcast;
    const current = currentEntry(podcast.queue);
    if (!current) return;
    try {
      const episode = await this.database
        .getPodcastEpisodeByMediaItemId(current.trackId)
        .catch(() => null);
      if (!episode) return;
      const threshold =
        podcast.durationMs > 0
          ? Math.max(podcast.durationMs - 30_000, podcast.durationMs * 0.95)
          : Number.POSITIVE_INFINITY;
      if (podcast.state === 'ended' || podcast.positionMs >= threshold) {
        await this.database.setPodcastEpisodePlayed(episode.episodeId, true);
      } else {
        await this.database.setPodcastEpisodeResume(episode.episodeId, podcast.positionMs);
      }
    } catch (error) {
      this.options.logger.error('playback.podcast.resume.persist.failed', { error });
    }
  }

  // Exposed for diagnostics and integration tests.
  /** Most recently reported buffered-ahead seconds from the renderer engine. */
  bufferHealth(): number {
    return this.bufferSeconds;
  }

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
