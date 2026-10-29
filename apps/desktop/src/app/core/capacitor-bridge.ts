import { Injectable } from '@angular/core';
import type {
  AppInfo,
  CacheStats,
  DiagnosticsInfo,
  DownloadProgress,
  DownloadQueueSnapshot,
  DownloadStats,
  DownloadSummary,
  DownloadView,
  EngineCommand,
  EngineEvent,
  EngineLoadRequest,
  HealthCheck,
  ImportProgress,
  ImportSummary,
  JellyfinResult,
  JellyfinServerView,
  JellyfinSyncSummary,
  LibraryStats,
  PlaybackCommand,
  PlaybackEvent,
  PlaybackSnapshot,
  QueueSnapshot,
  Result,
  Settings,
  StatocystBridge,
  ThemePreference,
  DensityPreference,
  Track,
} from '@statocyst/contracts';
import {
  applyQueueCommand,
  advanceAfterEnd,
  createQueue,
  currentEntry,
  type QueueContext,
  type QueueEntryModel,
  type QueueModel,
} from '@statocyst/playback-core';

/**
 * Renderer-side bridge used when Statocyst runs as a Capacitor Android app.
 * There is no Electron main process, so the authoritative queue/playback state
 * lives in the renderer. Playback uses the WebView's <audio> element (the same
 * AudioEngineService as on desktop).
 */
interface NativePlayerState {
  state: PlaybackSnapshot['state'];
  entryId: string | null;
  trackId: string | null;
  positionMs: number;
  durationMs: number;
  shuffle: boolean;
  repeat: PlaybackSnapshot['repeat'];
}

interface NativePlayerQueue {
  entries: Array<{ entryId: string; trackId: string }>;
  currentEntryId: string | null;
}

@Injectable({ providedIn: 'root' })
export class CapacitorBridge {

  constructor() {
    this.queueReady = this.restoreQueue();
    void this.mirrorSessionToNative();
    void this.initNativePlayback();
  }

  private queue: QueueModel = createQueue();
  private snapshot: PlaybackSnapshot = {
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
  private tracks = new Map<string, Track>();
  private token = 0;
  private loadedEntryId: string | null = null;
  private onLoadCb: ((request: EngineLoadRequest) => void) | null = null;
  private onCommandCb: ((command: EngineCommand) => void) | null = null;
  private eventListeners = new Set<(event: PlaybackEvent) => void>();
  private downloadListeners = new Set<(progress: DownloadProgress) => void>();
  private queueListeners = new Set<(snapshot: DownloadQueueSnapshot) => void>();
  private importListeners = new Set<(progress: ImportProgress) => void>();
  private cacheListeners = new Set<() => void>();
  private nativeListenersAttached = false;
  private lastImport: ImportSummary | null = null;

  /** The native Statocyst plugin (Capacitor Android), or undefined elsewhere. */
  private plugin(): any {
    return (window as any).Capacitor?.Plugins?.['Statocyst'];
  }

  private attachNativeListeners(): void {
    if (this.nativeListenersAttached) return;
    const plugin = this.plugin();
    if (!plugin?.addListener) return;
    this.nativeListenersAttached = true;
    void plugin.addListener('downloadProgress', (raw: Record<string, unknown>) => {
      const progress: DownloadProgress = {
        trackId: String(raw['trackId'] ?? ''),
        receivedBytes: Number(raw['receivedBytes'] ?? 0),
        totalBytes: raw['totalBytes'] == null ? null : Number(raw['totalBytes']),
        done: Boolean(raw['done']),
        error: raw['error'] == null ? null : String(raw['error']),
      };
      for (const listener of this.downloadListeners) listener(progress);
    });
    void plugin.addListener('downloadQueue', (raw: Record<string, unknown>) => {
      const snapshot = this.toQueueSnapshot(raw);
      for (const listener of this.queueListeners) listener(snapshot);
    });
    void plugin.addListener('importProgress', (raw: Record<string, unknown>) => {
      const progress: ImportProgress = {
        phase: raw['phase'] === 'scanning' ? 'scanning' : 'importing',
        scanned: Number(raw['scanned'] ?? 0),
        total: raw['total'] == null ? null : Number(raw['total']),
        imported: Number(raw['imported'] ?? 0),
        currentPath: raw['currentPath'] == null ? null : String(raw['currentPath']),
      };
      for (const listener of this.importListeners) listener(progress);
    });
    void plugin.addListener('cacheChanged', () => {
      for (const listener of this.cacheListeners) listener();
    });
  }

  /** The id native storage knows a server by: its Jellyfin id, or the entry id when discovery failed. */
  private nativeServerId(server: JellyfinServerView): string {
    return server.jellyfinId || server.id;
  }

  /**
   * Mirrors every stored Jellyfin session into native storage, which the download
   * manager, rolling cache and stream resolver read. All signed-in servers are
   * mirrored, so tracks from any of them stream, download and show artwork. A
   * server with no token has its native session dropped, so a stale entry cannot
   * keep a signed-out server alive.
   */
  private async mirrorSessionToNative(): Promise<void> {
    const plugin = this.plugin();
    if (!plugin?.saveSession) return;
    for (const server of this.loadServers()) {
      const token = localStorage.getItem(`statocyst.jellyfin.token.${server.id}`);
      const userId = localStorage.getItem(`statocyst.jellyfin.userId.${server.id}`);
      try {
        if (token && userId) {
          await plugin.saveSession({
            url: server.url,
            userId,
            token,
            serverId: this.nativeServerId(server),
          });
        } else {
          await plugin.removeSession?.({ serverId: this.nativeServerId(server) });
        }
      } catch {
        // The renderer still holds the session; a later login retries the mirror.
      }
    }
  }

  /** Re-mirrors the remaining sessions, or clears native storage when none are left. */
  private async refreshNativeSession(): Promise<void> {
    const servers = this.loadServers();
    const hasSession = servers.some(
      (server) =>
        !!localStorage.getItem(`statocyst.jellyfin.token.${server.id}`) &&
        !!localStorage.getItem(`statocyst.jellyfin.userId.${server.id}`),
    );
    if (!hasSession) {
      try {
        await this.plugin()?.clearSession?.();
      } catch {
        /* nothing else to do */
      }
      return;
    }
    await this.mirrorSessionToNative();
  }

  // ------------------------------------------------------------------
  // Native playback (Android). The ExoPlayer in PlaybackService owns audio,
  // the queue order, shuffle and repeat, so the notification, lock screen and
  // Android Auto all control the same player. Here the queue model only
  // computes edits; transport and modes are delegated and state is mirrored.
  // ------------------------------------------------------------------

  private nativePlayback = false;

  private async initNativePlayback(): Promise<void> {
    const plugin = this.plugin();
    if (!plugin?.setQueue || !plugin?.getPlaybackState || !plugin?.addListener) return;
    this.nativePlayback = true;
    void plugin.addListener('playerState', (raw: NativePlayerState) => this.adoptNativeState(raw));
    void plugin.addListener('playerQueue', (raw: NativePlayerQueue) => this.adoptNativeQueue(raw));
    void plugin.addListener('playerPosition', (raw: { positionMs: number; durationMs: number }) => {
      this.snapshot = {
        ...this.snapshot,
        positionMs: raw.positionMs,
        durationMs: raw.durationMs || this.snapshot.durationMs,
      };
      this.emitPosition();
    });
    try {
      const initial = await plugin.getPlaybackState();
      this.adoptNativeQueue(initial.queue);
      this.adoptNativeState(initial.state);
    } catch {
      // The listeners above still deliver the first state change.
    }
  }

  private adoptNativeQueue(raw: NativePlayerQueue): void {
    this.queue = {
      ...this.queue,
      entries: (raw.entries ?? []).map((entry) => ({ entryId: entry.entryId, trackId: entry.trackId })),
      currentEntryId: raw.currentEntryId ?? null,
      shuffleRemaining: [],
    };
    this.emitQueue();
  }

  private adoptNativeState(raw: NativePlayerState): void {
    const track = raw.trackId ? (this.tracks.get(raw.trackId) ?? null) : null;
    this.queue = {
      ...this.queue,
      shuffle: !!raw.shuffle,
      repeat: raw.repeat ?? 'off',
      currentEntryId: raw.entryId ?? null,
    };
    this.snapshot = {
      ...this.snapshot,
      state: raw.state,
      currentEntryId: raw.entryId ?? null,
      positionMs: raw.positionMs,
      durationMs: raw.durationMs || track?.durationMs || 0,
      shuffle: !!raw.shuffle,
      repeat: raw.repeat ?? 'off',
      track,
    };
    this.emitState();
  }

  /** Pushes the JS-computed queue (after an edit) down to the native player. */
  private async pushQueueToNative(opts: { play: boolean; keepCurrent: boolean }): Promise<void> {
    const settings = await this.getSettings().catch(() => null);
    await this.plugin().setQueue({
      entries: this.queue.entries.map((e) => ({ entryId: e.entryId, trackId: e.trackId })),
      currentEntryId: this.queue.currentEntryId,
      startPositionMs: 0,
      play: opts.play,
      keepCurrent: opts.keepCurrent,
      cacheBudgetBytes: settings?.cacheBudgetBytes,
      quality: settings?.quality,
    });
  }

  private async applyNativeCommand(command: PlaybackCommand): Promise<Result<PlaybackSnapshot>> {
    const plugin = this.plugin();
    const fail = (code: string, message: string): Result<PlaybackSnapshot> =>
      ({ ok: false, error: { code: code as never, message } });
    try {
      switch (command.type) {
        case 'play': {
          if (!command.trackId) {
            await plugin.play();
            break;
          }
          const outcome = applyQueueCommand(this.queue, command, this.context());
          if (outcome.error) return fail(outcome.error.code, outcome.error.message);
          this.queue = outcome.queue;
          if (outcome.queueChanged) {
            await this.pushQueueToNative({ play: true, keepCurrent: false });
          } else if (outcome.selection?.entryId) {
            await plugin.playEntry({ entryId: outcome.selection.entryId });
          }
          break;
        }
        case 'playEntry':
          await plugin.playEntry({ entryId: command.entryId });
          break;
        case 'pause':
          await plugin.pause();
          break;
        case 'seek':
          if (!Number.isFinite(command.positionMs) || command.positionMs < 0) {
            return fail('INVALID_ARGUMENT', 'Seek position must be a non-negative number');
          }
          await plugin.seekTo({ positionMs: command.positionMs });
          this.snapshot = { ...this.snapshot, positionMs: command.positionMs };
          this.emitPosition();
          break;
        case 'skipNext':
          if (this.queue.entries.length === 0) return fail('NO_CURRENT_TRACK', 'The queue is empty');
          await plugin.skipNext();
          break;
        case 'skipPrevious':
          if (this.queue.entries.length === 0) return fail('NO_CURRENT_TRACK', 'The queue is empty');
          await plugin.skipPrevious();
          break;
        case 'setShuffle':
          await plugin.setShuffle({ enabled: command.enabled });
          this.queue = { ...this.queue, shuffle: command.enabled };
          this.snapshot = { ...this.snapshot, shuffle: command.enabled };
          this.emitState();
          break;
        case 'setRepeat':
          await plugin.setRepeat({ mode: command.mode });
          this.queue = { ...this.queue, repeat: command.mode };
          this.snapshot = { ...this.snapshot, repeat: command.mode };
          this.emitState();
          break;
        case 'setVolume':
          this.snapshot = { ...this.snapshot, volume: command.volume };
          await plugin.setVolume({ volume: command.volume, muted: this.snapshot.muted });
          break;
        case 'setMuted':
          this.snapshot = { ...this.snapshot, muted: command.muted };
          await plugin.setVolume({ volume: this.snapshot.volume, muted: command.muted });
          break;
        default: {
          // enqueue / playNext / remove / reorder / clear: compute the edit,
          // then push the new order down while the current item keeps playing.
          const wasPlaying = this.snapshot.state === 'playing' || this.snapshot.state === 'buffering';
          const outcome = applyQueueCommand(this.queue, command, this.context());
          if (outcome.error) return fail(outcome.error.code, outcome.error.message);
          this.queue = outcome.queue;
          if (outcome.queueChanged) {
            await this.pushQueueToNative({ play: wasPlaying, keepCurrent: true });
          }
        }
      }
    } catch (error) {
      return fail('INTERNAL_ERROR', String(error));
    }
    this.emitQueue();
    return { ok: true, value: this.snapshotOf() };
  }

  private context(): QueueContext {
    return {
      isKnownTrack: (trackId) => this.tracks.has(trackId),
      createEntryId: (trackId) => `q_${crypto.randomUUID()}`,
      random: Math.random,
    };
  }

  private emitEvent(event: PlaybackEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private emitState(): void {
    this.emitEvent({ type: 'stateChanged', snapshot: { ...this.snapshot } });
  }

  private emitPosition(): void {
    this.emitEvent({ type: 'positionChanged', positionMs: this.snapshot.positionMs, durationMs: this.snapshot.durationMs });
  }

  private emitQueue(): void {
    this.emitEvent({ type: 'queueChanged', queue: this.queueOf() });
  }

  private async loadEntry(entryId: string, autoplay: boolean, startPositionMs = 0): Promise<void> {
    const entry = this.queue.entries.find((e) => e.entryId === entryId);
    if (!entry) return;
    const track = this.tracks.get(entry.trackId);
    if (!track) return;
    this.queue.currentEntryId = entryId;
    this.token += 1;
    this.loadedEntryId = entryId;
    // Ask the native plugin what to load: a pinned download, the rolling cache,
    // an imported library file served over the local media server, or the
    // authenticated Jellyfin stream. Native resolution keeps offline playback
    // and range/seek behaviour identical to a remote stream.
    let mediaUrl: string | null = null;
    const plugin = this.plugin();
    if (plugin?.playbackUrl) {
      try {
        const settings = await this.getSettings();
        const resolved = await plugin.playbackUrl({
          trackId: track.id,
          budgetBytes: settings.cacheBudgetBytes,
        });
        mediaUrl = typeof resolved?.url === 'string' ? resolved.url : null;
      } catch {
        mediaUrl = null;
      }
    } else if (track.sourceId === 'jellyfin' || track.sourceLabel === 'Jellyfin') {
      // Fallback for a renderer without the native plugin (e.g. a browser smoke
      // test): build the stream URL from the stored session.
      const servers = this.loadServers();
      const ordered = [
        ...servers.filter((server) => server.connected),
        ...servers.filter((server) => !server.connected),
      ];
      const resolved = ordered
        .map((server) => ({
          url: server.url,
          token: localStorage.getItem(`statocyst.jellyfin.token.${server.id}`) ?? '',
        }))
        .find((candidate) => candidate.url && candidate.token);
      if (resolved) {
        const itemId = track.id.replace(/^jf-/, '');
        mediaUrl = `${resolved.url}/Audio/${itemId}/stream?static=true&api_key=${encodeURIComponent(resolved.token)}`;
      }
    }

    if (!mediaUrl) {
      // Never hand the player a scheme that cannot resolve; surface the failure.
      this.snapshot = {
        ...this.snapshot,
        currentEntryId: entryId,
        durationMs: track.durationMs,
        positionMs: startPositionMs,
        state: 'error',
        track,
      };
      this.emitState();
      this.emitPosition();
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      currentEntryId: entryId,
      durationMs: track.durationMs,
      positionMs: startPositionMs,
      state: autoplay ? 'buffering' : 'paused',
      track,
    };
    const request: EngineLoadRequest = {
      token: this.token,
      entryId,
      trackId: track.id,
      url: mediaUrl,
      autoplay,
      startPositionMs,
      durationMs: track.durationMs,
      volume: this.snapshot.volume,
      muted: this.snapshot.muted,
    };
    this.onLoadCb?.(request);
  }

  /** The native state can arrive before the library loads; fill the track in late. */
  private refreshCurrentTrack(): void {
    if (!this.nativePlayback || this.snapshot.track) return;
    const entry = this.queue.entries.find((e) => e.entryId === this.snapshot.currentEntryId);
    const track = entry ? this.tracks.get(entry.trackId) : undefined;
    if (!track) return;
    this.snapshot = { ...this.snapshot, track, durationMs: this.snapshot.durationMs || track.durationMs };
    this.emitState();
    this.emitQueue();
  }

  private snapshotOf(): PlaybackSnapshot {
    return { ...this.snapshot };
  }

  private queueOf(): QueueSnapshot {
    return {
      entries: this.queue.entries.map((e) => ({
        entryId: e.entryId,
        trackId: e.trackId,
        track: this.trackView(e.trackId),
      })),
      currentEntryId: this.queue.currentEntryId,
      shuffle: this.queue.shuffle,
      repeat: this.queue.repeat,
    };
  }

  /**
   * A restored queue can outlive the library that filled it (a sync or a track
   * removal). Returning a placeholder keeps the queue renderable instead of
   * handing the view an undefined track, and the real metadata replaces it as
   * soon as the library loads.
   */
  private trackView(trackId: string): Track {
    const known = this.tracks.get(trackId);
    if (known) return known;
    return {
      id: trackId,
      title: 'Unavailable track',
      artist: 'Unknown artist',
      album: 'Unknown album',
      durationMs: 0,
      artworkUrl: null,
      sourceId: 'unknown',
      sourceLabel: 'Unknown',
      missing: true,
    };
  }

  async applyCommand(command: PlaybackCommand): Promise<Result<PlaybackSnapshot>> {
    if (this.nativePlayback) return this.applyNativeCommand(command);
    // Apply queue commands via the shared state machine.
    if (['play', 'playEntry', 'skipNext', 'skipPrevious', 'enqueue', 'playNext', 'remove', 'reorder', 'setShuffle', 'setRepeat', 'clear'].includes(command.type)) {
      const outcome = applyQueueCommand(this.queue, command, this.context());
      if (outcome.error) {
        return { ok: false, error: { code: outcome.error.code as never, message: outcome.error.message } };
      }
      this.queue = outcome.queue;
      if (outcome.queueChanged) this.emitQueue();
      void this.persistQueue();
      if (outcome.shuffleChanged || outcome.repeatChanged) { /* persist later */ }

      if (outcome.selection) {
        const { reason, entryId } = outcome.selection;
        if (reason === 'none' || !entryId) {
          this.snapshot = { ...this.snapshot, state: this.queue.entries.length > 0 ? 'ended' : 'idle', positionMs: 0, durationMs: 0 };
          this.emitState();
          return { ok: true, value: this.snapshotOf() };
        }
        const autoplay = command.type === 'play' || command.type === 'playEntry' || command.type === 'skipNext' || command.type === 'skipPrevious';
        const startPosition = reason === 'restart' ? 0 : entryId === this.loadedEntryId ? this.snapshot.positionMs : 0;
        await this.loadEntry(entryId, autoplay, startPosition);
        return { ok: true, value: this.snapshotOf() };
      } else if (outcome.queueChanged) {
        this.emitState();
      }
      return { ok: true, value: this.snapshotOf() };
    }

    // Non-queue commands.
    switch (command.type) {
      case 'pause':
        this.onCommandCb?.({ token: this.token, action: 'pause' });
        this.snapshot = { ...this.snapshot, state: this.queue.currentEntryId ? 'paused' : 'idle' };
        this.emitState();
        break;
      case 'seek':
        this.onCommandCb?.({ token: this.token, action: 'seek', positionMs: command.positionMs });
        this.snapshot = { ...this.snapshot, positionMs: command.positionMs };
        this.emitPosition();
        break;
      case 'setVolume':
        this.onCommandCb?.({ token: this.token, action: 'volume', volume: command.volume, muted: this.snapshot.muted });
        this.snapshot = { ...this.snapshot, volume: command.volume };
        break;
      case 'setMuted':
        this.onCommandCb?.({ token: this.token, action: 'volume', volume: this.snapshot.volume, muted: command.muted });
        this.snapshot = { ...this.snapshot, muted: command.muted };
        break;
    }
    return { ok: true, value: this.snapshotOf() };
  }

  // Engine bridge implementation
  handleEngineReport(event: EngineEvent): void {
    if (typeof event.token !== 'number' || event.token !== this.token) return;
    switch (event.type) {
      case 'ready':
        if (event.durationMs > 0) this.snapshot = { ...this.snapshot, durationMs: event.durationMs };
        this.emitPosition();
        break;
      case 'state':
        if (event.state === 'playing') this.snapshot = { ...this.snapshot, state: 'playing' };
        else if (event.state === 'paused') this.snapshot = { ...this.snapshot, state: 'paused' };
        else this.snapshot = { ...this.snapshot, state: 'buffering' };
        this.emitState();
        break;
      case 'time':
        this.snapshot = { ...this.snapshot, positionMs: event.positionMs, durationMs: event.durationMs || this.snapshot.durationMs };
        this.emitPosition();
        break;
      case 'ended':
        void this.handleEnded();
        break;
      case 'error':
        this.snapshot = { ...this.snapshot, state: 'error' };
        this.emitState();
        break;
    }
  }

  private async handleEnded(): Promise<void> {
    const outcome = advanceAfterEnd(this.queue, this.context());
    if (outcome.error) {
      this.snapshot = { ...this.snapshot, state: 'ended', positionMs: this.snapshot.durationMs };
      this.emitState();
      return;
    }
    this.queue = outcome.queue;
    void this.persistQueue();
    if (outcome.selection?.entryId && outcome.selection.reason !== 'none') {
      await this.loadEntry(outcome.selection.entryId, true, 0);
    } else {
      this.snapshot = { ...this.snapshot, state: 'ended', positionMs: this.snapshot.durationMs };
      this.emitState();
      this.emitPosition();
    }
  }

  // Public bridge methods
  async getSnapshot(): Promise<PlaybackSnapshot> { return this.snapshotOf(); }
  async getQueue(): Promise<QueueSnapshot> { return this.queueOf(); }
  async command(command: PlaybackCommand): Promise<Result<PlaybackSnapshot>> { return this.applyCommand(command); }

  // Engine bridge
  setOnLoad(cb: (request: EngineLoadRequest) => void): void { this.onLoadCb = cb; }
  setOnCommand(cb: (command: EngineCommand) => void): void { this.onCommandCb = cb; }
  reportEngineEvent(event: EngineEvent): void { this.handleEngineReport(event); }

  // Library
  async listTracks(): Promise<Track[]> {
    try {
      const result = await (window as any).Capacitor?.Plugins?.['Statocyst']?.listTracks?.() ?? { tracks: [] };
      const rawTracks = (result.tracks ?? []) as Array<Record<string, unknown>>;

      const tracks: Track[] = rawTracks.map((t) => this.toTrack(t));
      this.tracks.clear();
      for (const t of tracks) this.tracks.set(t.id, t);
      this.refreshCurrentTrack();
      // A queue restored before the library was readable may hold placeholders;
      // republish it now that real track metadata exists.
      if (this.queue.entries.length > 0) this.emitQueue();
      return tracks;
    } catch {
      return [];
    }
  }

  async stats(): Promise<LibraryStats> {
    const tracks = await this.listTracks();
    const albums = new Set(tracks.map((t) => t.album));
    const artists = new Set(tracks.map((t) => t.artist));
    return {
      tracks: tracks.length,
      albums: albums.size,
      artists: artists.size,
      durationMs: tracks.reduce((s, t) => s + t.durationMs, 0),
      missing: 0,
    };
  }

  // Settings — persisted via Capacitor Preferences on Android
  async getSettings(): Promise<Settings> {
    const prefs = (window as any).Capacitor?.Plugins?.Preferences;
    const getPref = async (key: string) => {
      try {
        const res = await prefs?.get?.({ key });
        return res?.value ?? null;
      } catch {
        return null;
      }
    };
    const theme = (await getPref('theme')) ?? 'system';
    const density = (await getPref('density')) ?? 'comfortable';
    const volume = parseFloat((await getPref('volume')) ?? '0.85');
    const muted = (await getPref('muted')) === 'true';
    const quality = ((await getPref('quality')) ?? 'lossless') as Settings['quality'];
    const budget = Number((await getPref('cacheBudgetBytes')) ?? 2 * 1024 * 1024 * 1024);
    const listeningHistory = (await getPref('listeningHistory')) === 'true';
    return {
      theme: theme as Settings['theme'],
      density: density as Settings['density'],
      volume,
      muted,
      quality,
      cacheBudgetBytes: Number.isFinite(budget) && budget > 0 ? budget : 2 * 1024 * 1024 * 1024,
      listeningHistory,
    };
  }
  async setSettings(patch: Partial<Settings>): Promise<Settings> {
    const prefs = (window as any).Capacitor?.Plugins?.Preferences;
    const setPref = async (key: string, value: string) => {
      try {
        await prefs?.set?.({ key, value });
      } catch {
        /* ignore */
      }
    };
    const next = { ...await this.getSettings(), ...patch };
    if (patch.theme !== undefined) await setPref('theme', String(next.theme));
    if (patch.density !== undefined) await setPref('density', String(next.density));
    if (patch.volume !== undefined) await setPref('volume', String(next.volume));
    if (patch.muted !== undefined) await setPref('muted', String(next.muted));
    if (patch.quality !== undefined) {
      await setPref('quality', String(next.quality));
      try {
        await (window as any).Capacitor?.Plugins?.['Statocyst']?.setQuality?.({ quality: next.quality });
      } catch {
        /* applied with the next queue */
      }
    }
    if (patch.cacheBudgetBytes !== undefined)
      await setPref('cacheBudgetBytes', String(next.cacheBudgetBytes));
    if (patch.listeningHistory !== undefined)
      await setPref('listeningHistory', String(next.listeningHistory));
    try {
      localStorage.setItem('statocyst.settings', JSON.stringify(next));
    } catch {
      /* ignore */
    }
    return next;
  }

  // App info and diagnostics — read from the native plugin, never invented.
  private toTrack(raw: Record<string, unknown>): Track {
    const id = String(raw['id'] ?? '');
    const sourceKind = String(raw['sourceKind'] ?? 'local');
    const sourceLabel = String(raw['sourceLabel'] ?? 'Local');

    // Jellyfin artwork comes from the native loopback route, which adds the session
    // header itself: the token is never put into an image URL. Without the native
    // plugin (browser smoke tests) a Jellyfin track simply has no artwork.
    const nativeArtwork = raw['artworkUrl'];
    const artworkUrl = typeof nativeArtwork === 'string' && nativeArtwork ? nativeArtwork : null;

    const nativeArtist = raw['artistArtworkUrl'];
    const artistArtworkUrl = typeof nativeArtist === 'string' && nativeArtist ? nativeArtist : null;

    return {
      id,
      title: String(raw['title'] ?? 'Untitled'),
      artist: String(raw['artist'] ?? 'Unknown artist'),
      album: String(raw['album'] ?? 'Unknown album'),
      albumArtist: String(raw['albumArtist'] ?? raw['artist'] ?? 'Unknown artist'),
      durationMs: Number(raw['durationMs'] ?? 0),
      artworkUrl,
      artistArtworkUrl,
      sourceId: String(raw['sourceId'] ?? sourceKind),
      sourceLabel,
      trackNo: (raw['trackNo'] as number | null) ?? null,
      year: (raw['year'] as number | null) ?? null,
      genre: (raw['genre'] as string | null) ?? null,
      format: (raw['format'] as string | null) ?? null,
      missing: Boolean(raw['missing']),
      ...(Array.isArray(raw['aliases']) && raw['aliases'].length > 0
        ? { aliases: (raw['aliases'] as unknown[]).map(String) }
        : {}),
    };
  }

  private importSummaryFromNative(raw: any): ImportSummary {
    const summary: ImportSummary = {
      sourceId: raw?.sourceId == null ? null : String(raw.sourceId),
      sourceLabel: raw?.sourceLabel == null ? null : String(raw.sourceLabel),
      imported: Number(raw?.imported ?? 0),
      duplicates: Number(raw?.duplicates ?? 0),
      missing: Number(raw?.missing ?? 0),
      rejected: Array.isArray(raw?.rejected)
        ? raw.rejected.map((entry: any) => ({
            path: String(entry?.path ?? ''),
            code: String(entry?.code ?? 'IMPORT_FAILED'),
            message: String(entry?.message ?? entry?.code ?? 'Import failed'),
          }))
        : [],
      tracks: Array.isArray(raw?.tracks)
        ? (raw.tracks as Array<Record<string, unknown>>).map((t) => this.toTrack(t))
        : [],
      cancelled: Boolean(raw?.cancelled),
    };
    this.lastImport = summary;
    for (const track of summary.tracks) this.tracks.set(track.id, track);
    return summary;
  }

  async getAppInfo(): Promise<AppInfo> {
    const plugin = this.plugin();
    let native: any = null;
    try {
      native = await plugin?.appInfo?.();
    } catch {
      native = null;
    }
    return {
      name: 'Statocyst',
      version: String(native?.version ?? '0.1.0'),
      electron: 'n/a (Capacitor)',
      chrome: navigator.userAgent,
      node: 'n/a',
      platform: 'android',
      dataPath: String(native?.dataPath ?? ''),
      databasePath: '',
      logPath: '',
      packaged: true,
    };
  }

  private currentCacheBudget(): Promise<number> {
    return this.getSettings().then((settings) => settings.cacheBudgetBytes).catch(() => 2 * 1024 * 1024 * 1024);
  }

  async getDiagnostics(): Promise<DiagnosticsInfo> {
    const plugin = this.plugin();
    try {
      const raw = await plugin?.diagnostics?.({ budgetBytes: await this.currentCacheBudget() });
      if (raw) {
        return {
          databasePath: String(raw.databasePath ?? ''),
          logPath: String(raw.logPath ?? ''),
          databaseBytes: Number(raw.databaseBytes ?? 0),
          cacheBytes: Number(raw.cacheBytes ?? 0),
          schemaVersion: Number(raw.schemaVersion ?? 0),
          integrity: raw.integrity === 'ok' || raw.integrity === 'failed' ? raw.integrity : 'unknown',
          queueEntries: this.queue.entries.length,
          trackCount: Number(raw.trackCount ?? this.tracks.size),
        };
      }
    } catch {
      /* fall through to the renderer view */
    }
    return {
      databasePath: '',
      logPath: '',
      databaseBytes: 0,
      cacheBytes: 0,
      schemaVersion: 0,
      integrity: 'unknown',
      queueEntries: this.queue.entries.length,
      trackCount: this.tracks.size,
    };
  }

  // Bridge properties (StatocystBridge interface)
  app = {
    info: async () => this.getAppInfo(),
    diagnostics: async () => this.getDiagnostics(),
    health: async (): Promise<HealthCheck[]> => {
      try {
        const raw = await this.plugin()?.healthChecks?.({ budgetBytes: await this.currentCacheBudget() });
        const checks: HealthCheck[] = Array.isArray(raw?.checks)
          ? raw.checks.map((check: any) => ({
              id: String(check?.id ?? ''),
              label: String(check?.label ?? ''),
              status: check?.status === 'ok' || check?.status === 'fail' ? check.status : 'warn',
              detail: String(check?.detail ?? ''),
            }))
          : [];
        return checks;
      } catch {
        return [];
      }
    },
    exportSupportBundle: async () => {
      try {
        const raw = await this.plugin()?.exportSupportBundle?.({ budgetBytes: await this.currentCacheBudget() });
        return { ok: true as const, value: { path: raw?.path == null ? null : String(raw.path), bytes: Number(raw?.bytes ?? 0) } };
      } catch (error) {
        return {
          ok: false as const,
          error: { code: 'INTERNAL_ERROR' as const, message: String(error) },
        };
      }
    },
    openDataFolder: async () => {},
    quit: () => {},
  };

  library = {
    pickFiles: async () => {
      this.attachNativeListeners();
      try {
        return this.importSummaryFromNative(await this.plugin()?.pickFiles?.());
      } catch (error) {
        return this.failedImport(String(error));
      }
    },
    pickFolder: async () => {
      this.attachNativeListeners();
      try {
        return this.importSummaryFromNative(await this.plugin()?.pickFolder?.());
      } catch (error) {
        return this.failedImport(String(error));
      }
    },
    importPaths: async (paths: string[]) => {
      this.attachNativeListeners();
      try {
        return this.importSummaryFromNative(await this.plugin()?.importPaths?.({ paths }));
      } catch (error) {
        return this.failedImport(String(error));
      }
    },
    // Android has no bundled demo assets; report an honest empty import rather
    // than pretending to add tracks.
    importDemoLibrary: async () => ({
      sourceId: null,
      sourceLabel: null,
      imported: 0,
      duplicates: 0,
      missing: 0,
      rejected: [],
      tracks: [],
      cancelled: true,
    }),
    listTracks: async () => this.listTracks(),
    stats: async () => this.stats(),
    removeTrack: async (trackId: string) => {
      try {
        const raw = await this.plugin()?.removeTrack?.({ trackId });
        return { ok: true as const, value: { removed: Boolean(raw?.removed) } };
      } catch (error) {
        return {
          ok: false as const,
          error: { code: 'INTERNAL_ERROR' as const, message: String(error) },
        };
      }
    },
    onImportProgress: (listener: (progress: ImportProgress) => void) => {
      this.importListeners.add(listener);
      this.attachNativeListeners();
      return () => this.importListeners.delete(listener);
    },
    cancelImport: async () => {
      try {
        await this.plugin()?.cancelImport?.();
      } catch {
        /* the next progress callback stops the loop */
      }
    },
  };

  private failedImport(message: string): ImportSummary {
    const summary: ImportSummary = {
      sourceId: null,
      sourceLabel: null,
      imported: 0,
      duplicates: 0,
      missing: 0,
      rejected: [{ path: '', code: 'IMPORT_FAILED', message }],
      tracks: [],
      cancelled: false,
    };
    this.lastImport = summary;
    return summary;
  }

  playback = {
    getSnapshot: async () => this.snapshotOf(),
    getQueue: async () => {
      await this.queueReady;
      return this.queueOf();
    },
    command: async (command: PlaybackCommand) => this.applyCommand(command),
    onEvent: (listener: (event: PlaybackEvent) => void) => {
      this.eventListeners.add(listener);
      return () => this.eventListeners.delete(listener);
    },
  };

  settings = {
    get: async () => this.getSettings(),
    update: async (patch: Partial<Settings>) => this.setSettings(patch),
  };

  // Queue persistence helpers
  private queueReady: Promise<void> = Promise.resolve();

  private async restoreQueue(): Promise<void> {
    const prefs = (window as any).Capacitor?.Plugins?.Preferences;
    try {
      const saved = await prefs?.get?.({ key: 'queue' });
      if (saved?.value) {
        try {
          this.queue = JSON.parse(saved.value);
          if (this.queue.entries.length > 0) this.emitQueue();
        } catch { /* ignore corrupt data */ }
      }
    } catch { /* ignore */ }
  }

  private async persistQueue(): Promise<void> {
    const prefs = (window as any).Capacitor?.Plugins?.Preferences;
    try {
      await prefs?.set?.({ key: 'queue', value: JSON.stringify(this.queue) });
    } catch { /* ignore */ }
  }

  engine = {
    onLoad: (listener: (request: EngineLoadRequest) => void) => {
      this.onLoadCb = listener;
      return () => { this.onLoadCb = null; };
    },
    onCommand: (listener: (command: EngineCommand) => void) => {
      this.onCommandCb = listener;
      return () => { this.onCommandCb = null; };
    },
    report: (event: EngineEvent) => this.handleEngineReport(event),
  };

  /** Song radio from the native plugin (Jellyfin instant mix topped up by the local scorer). */
  private toBrowseAccess(result: any): { allowed: string[]; denied: string[] } {
    return {
      allowed: Array.isArray(result?.allowed) ? result.allowed.map(String) : [],
      denied: Array.isArray(result?.denied) ? result.denied.map(String) : [],
    };
  }

  async getBrowseAccess(): Promise<{ allowed: string[]; denied: string[] }> {
    return this.toBrowseAccess(await this.plugin().getBrowseAccess());
  }

  async setBrowseAllowed(request: {
    packageName: string;
    allowed: boolean;
  }): Promise<{ allowed: string[]; denied: string[] }> {
    return this.toBrowseAccess(await this.plugin().setBrowseAllowed(request));
  }

  async getExternalArtwork(): Promise<{ enabled: boolean }> {
    const result = await this.plugin().getExternalArtwork();
    return { enabled: result?.enabled === true };
  }

  async setExternalArtwork(request: { enabled: boolean }): Promise<{ enabled: boolean }> {
    const result = await this.plugin().setExternalArtwork({ enabled: request.enabled === true });
    return { enabled: result?.enabled === true };
  }

  async radio(request: { trackId: string; limit?: number }): Promise<{ trackIds: string[]; source: string }> {
    const result = await this.plugin().radio({ trackId: request.trackId, limit: request.limit ?? 50 });
    return {
      trackIds: Array.isArray(result?.trackIds) ? result.trackIds.map(String) : [],
      source: String(result?.source ?? 'local'),
    };
  }

  jellyfin = {
    listServers: async () => this.loadServersValidated(),
    addServer: async (url: string) => {
      const normalized = url.trim().replace(/\/+$/, '');
      try {
        const plugin = (window as any).Capacitor?.Plugins?.['Statocyst'];
        let info: { id: string; name: string; version: string; url: string } | null = null;
        try {
          info = await plugin?.discoverServer?.({ url: normalized });
        } catch {
          // Discovery may fail behind SSO/proxies (e.g. Authentik). Fall back to
          // a URL-only server entry so the user can still attempt sign-in.
        }
        const server: JellyfinServerView = info
          ? {
              id: info.id,
              url: info.url || normalized,
              name: info.name,
              jellyfinId: info.id,
              version: info.version,
              connected: false,
              userName: null,
            }
          : {
              id: `server-${Date.now()}`,
              url: normalized,
              name: new URL(normalized).hostname,
              jellyfinId: '',
              version: '',
              connected: false,
              userName: null,
            };
        const servers = this.loadServers();
        const existing = servers.findIndex((x) => x.url === server.url);
        // Cloned servers (VM copies, the Jellyfin demo instances) report the same
        // id. Sessions, tokens and track ownership are keyed by it, so give the
        // newcomer its own id rather than letting it inherit another server's login.
        if (servers.some((x, index) => index !== existing && x.id === server.id)) {
          let hash = 0;
          for (const ch of server.url) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
          server.id = `${server.id}-${hash.toString(36)}`;
          if (server.jellyfinId) server.jellyfinId = server.id;
        }
        if (existing >= 0) servers[existing] = server;
        else servers.push(server);
        this.saveServers(servers);
        return { ok: true, value: server };
      } catch (error) {
        return { ok: false, error: { code: 'UNREACHABLE' as const, message: String(error) } };
      }
    },
    login: async (url: string, username: string, password: string) => {
      try {
        const plugin = (window as any).Capacitor?.Plugins?.['Statocyst'];
        const auth = await plugin?.login?.({ url, username, password });
        if (!auth) return { ok: false, error: { code: 'AUTH_FAILED' as const, message: 'Login failed' } };
        const servers = this.loadServers();
        const server = servers.find((s) => s.url === url);
        if (!server) return { ok: false, error: { code: 'NOT_FOUND' as const, message: 'Server not found' } };
        // If discovery failed earlier (e.g. behind Authentik), adopt the server id
        // from the auth response so sync and artwork URLs resolve correctly.
        if (!server.jellyfinId && auth.serverId) {
          server.id = auth.serverId;
          server.jellyfinId = auth.serverId;
        }
        server.connected = true;
        server.userName = auth.userName;
        localStorage.setItem(`statocyst.jellyfin.token.${server.id}`, auth.accessToken);
        localStorage.setItem(`statocyst.jellyfin.userId.${server.id}`, auth.userId);
        localStorage.setItem(`statocyst.jellyfin.serverUrl.${server.id}`, server.url);
        this.saveServers(servers);
        await this.mirrorSessionToNative();
        return { ok: true, value: server };
      } catch (error) {
        return { ok: false, error: { code: 'AUTH_FAILED' as const, message: String(error) } };
      }
    },
    logout: async (serverId: string) => {
      const servers = this.loadServers();
      const server = servers.find((s) => s.id === serverId);
      if (server) {
        server.connected = false;
        server.userName = null;
        localStorage.removeItem(`statocyst.jellyfin.token.${serverId}`);
        localStorage.removeItem(`statocyst.jellyfin.userId.${serverId}`);
        this.saveServers(servers);
        await this.refreshNativeSession();
      }
      return { ok: true, value: { removed: true } };
    },
    removeServer: async (serverId: string) => {
      const all = this.loadServers();
      const removed = all.find((s) => s.id === serverId);
      const servers = all.filter((s) => s.id !== serverId);
      this.saveServers(servers);
      localStorage.removeItem(`statocyst.jellyfin.token.${serverId}`);
      localStorage.removeItem(`statocyst.jellyfin.userId.${serverId}`);
      // Drop the server's tracks and downloads along with its session, so the merged
      // library never keeps tracks it can no longer play.
      if (removed) {
        try {
          await this.plugin()?.removeServerData?.({ serverId: this.nativeServerId(removed) });
        } catch {
          // Native cleanup failing must not leave the server half-removed in the UI.
        }
      }
      await this.refreshNativeSession();
      return { ok: true, value: { removed: true } };
    },
    sync: async (serverId: string) => {
      try {
        const servers = this.loadServers();
        const server = servers.find((s) => s.id === serverId);
        if (!server) return { ok: false, error: { code: 'NOT_FOUND' as const, message: 'Server not found' } };
        const token = localStorage.getItem(`statocyst.jellyfin.token.${serverId}`);
        const userId = localStorage.getItem(`statocyst.jellyfin.userId.${serverId}`);
        if (!token || !userId) {
          this.markDisconnected(serverId);
          return { ok: false, error: { code: 'UNAUTHORIZED' as const, message: 'Not signed in' } };
        }
        const plugin = (window as any).Capacitor?.Plugins?.['Statocyst'];
        const result = await plugin?.syncCatalog?.({
          url: server.url,
          userId,
          token,
          serverId: this.nativeServerId(server),
          serverName: server.name,
        });
        // A successful sync is proof the session works, so heal a stale badge.
        if (!server.connected) {
          server.connected = true;
          this.saveServers(servers);
        }
        return { ok: true, value: { serverId, total: result?.total ?? 0, imported: result?.imported ?? 0, updated: 0 } };
      } catch (error) {
        const message = String(error);
        if (message.includes('401')) {
          this.markDisconnected(serverId);
          return { ok: false, error: { code: 'UNAUTHORIZED' as const, message: 'Session expired — please sign in again' } };
        }
        return { ok: false, error: { code: 'INTERNAL_ERROR' as const, message } };
      }
    },
    initiateQuickConnect: async (url: string) => {
      try {
        const plugin = (window as any).Capacitor?.Plugins?.['Statocyst'];
        const result = await plugin?.initiateQuickConnect?.({ url });
        if (!result) return { ok: false, error: { code: 'UNREACHABLE' as const, message: 'Plugin not available' } };
        return { ok: true, value: { secret: result.secret, code: result.code } };
      } catch (error) {
        return { ok: false, error: { code: 'INTERNAL_ERROR' as const, message: String(error) } };
      }
    },
    pollQuickConnect: async (url: string, secret: string) => {
      try {
        const plugin = (window as any).Capacitor?.Plugins?.['Statocyst'];
        const result = await plugin?.pollQuickConnect?.({ url, secret });
        return { ok: true, value: { authenticated: result?.authenticated ?? false } };
      } catch (error) {
        return { ok: false, error: { code: 'INTERNAL_ERROR' as const, message: String(error) } };
      }
    },
    loginWithQuickConnect: async (url: string, secret: string) => {
      try {
        const plugin = (window as any).Capacitor?.Plugins?.['Statocyst'];
        const auth = await plugin?.loginWithQuickConnect?.({ url, secret });
        if (!auth) return { ok: false, error: { code: 'AUTH_FAILED' as const, message: 'Quick Connect failed' } };
        const servers = this.loadServers();
        const server = servers.find((s) => s.url === url);
        if (!server) return { ok: false, error: { code: 'NOT_FOUND' as const, message: 'Server not found' } };
        if (!server.jellyfinId && auth.serverId) {
          server.id = auth.serverId;
          server.jellyfinId = auth.serverId;
        }
        server.connected = true;
        server.userName = auth.userName;
        localStorage.setItem(`statocyst.jellyfin.token.${server.id}`, auth.accessToken);
        localStorage.setItem(`statocyst.jellyfin.userId.${server.id}`, auth.userId);
        this.saveServers(servers);
        await this.mirrorSessionToNative();
        return { ok: true, value: server };
      } catch (error) {
        return { ok: false, error: { code: 'AUTH_FAILED' as const, message: String(error) } };
      }
    },
    encryptionAvailable: async () => true,
  };

  private toQueueSnapshot(raw: any): DownloadQueueSnapshot {
    const entries = Array.isArray(raw?.entries) ? raw.entries : [];
    return {
      total: Number(raw?.total ?? 0),
      done: Number(raw?.done ?? 0),
      failed: Number(raw?.failed ?? 0),
      pending: Number(raw?.pending ?? 0),
      finished: Boolean(raw?.finished),
      receivedBytes: Number(raw?.receivedBytes ?? 0),
      totalBytes: raw?.totalBytes == null ? null : Number(raw.totalBytes),
      sizesKnown: Boolean(raw?.sizesKnown),
      entries: entries.map((e: any) => ({
        trackId: String(e?.trackId ?? ''),
        state: String(e?.state ?? 'queued') as DownloadQueueSnapshot['entries'][number]['state'],
        receivedBytes: Number(e?.receivedBytes ?? 0),
        totalBytes: e?.totalBytes == null ? null : Number(e.totalBytes),
        attempt: Number(e?.attempt ?? 0),
        error: e?.error == null ? null : String(e.error),
      })),
    };
  }

  downloads = {
    // Android keeps pinned, verified downloads in app-private storage.
    supported: true as const,
    enqueue: async (trackIds: string[]): Promise<DownloadQueueSnapshot> =>
      this.toQueueSnapshot(await this.plugin().enqueueDownloads({ trackIds })),
    cancelQueue: async (): Promise<DownloadQueueSnapshot> =>
      this.toQueueSnapshot(await this.plugin().cancelDownloads()),
    retryFailed: async (): Promise<DownloadQueueSnapshot> =>
      this.toQueueSnapshot(await this.plugin().retryFailedDownloads()),
    dismissQueue: async (): Promise<DownloadQueueSnapshot> =>
      this.toQueueSnapshot(await this.plugin().dismissDownloads()),
    queue: async (): Promise<DownloadQueueSnapshot> =>
      this.toQueueSnapshot(await this.plugin().getDownloadQueue()),
    onQueue: (listener: (snapshot: DownloadQueueSnapshot) => void) => {
      this.queueListeners.add(listener);
      this.attachNativeListeners();
      return () => this.queueListeners.delete(listener);
    },
    download: async (trackId: string): Promise<Result<DownloadSummary>> => {
      try {
        const raw = await this.plugin()?.downloadTrack?.({ trackId });
        return {
          ok: true as const,
          value: {
            trackId: String(raw?.trackId ?? trackId),
            sizeBytes: Number(raw?.sizeBytes ?? 0),
            sha256: String(raw?.sha256 ?? ''),
            verified: Boolean(raw?.verified),
          },
        };
      } catch (error) {
        return {
          ok: false as const,
          error: { code: 'INTERNAL_ERROR' as const, message: String(error) },
        };
      }
    },
    remove: async (trackId: string) => {
      try {
        const raw = await this.plugin()?.removeDownload?.({ trackId });
        return { ok: true as const, value: { removed: Boolean(raw?.removed) } };
      } catch (error) {
        return {
          ok: false as const,
          error: { code: 'INTERNAL_ERROR' as const, message: String(error) },
        };
      }
    },
    list: async (): Promise<DownloadView[]> => {
      try {
        const raw = await this.plugin()?.listDownloads?.();
        return Array.isArray(raw?.downloads) ? raw.downloads : [];
      } catch {
        return [];
      }
    },
    stats: async (): Promise<DownloadStats> => {
      try {
        const raw = await this.plugin()?.downloadStats?.();
        return { count: Number(raw?.count ?? 0), totalBytes: Number(raw?.totalBytes ?? 0) };
      } catch {
        return { count: 0, totalBytes: 0 };
      }
    },
    onProgress: (listener: (progress: DownloadProgress) => void) => {
      this.downloadListeners.add(listener);
      this.attachNativeListeners();
      return () => this.downloadListeners.delete(listener);
    },
  };

  cache = {
    stats: async (): Promise<CacheStats> => {
      const budgetBytes = await this.currentCacheBudget();
      try {
        const raw = await this.plugin()?.cacheStats?.({ budgetBytes });
        return {
          bytes: Number(raw?.bytes ?? 0),
          budgetBytes: Number(raw?.budgetBytes ?? budgetBytes),
          entries: Number(raw?.entries ?? 0),
          pressure: Boolean(raw?.pressure),
        };
      } catch {
        return { bytes: 0, budgetBytes, entries: 0, pressure: false };
      }
    },
    clear: async () => {
      try {
        const raw = await this.plugin()?.cacheClear?.();
        return { ok: true as const, value: { removed: Number(raw?.removed ?? 0) } };
      } catch (error) {
        return {
          ok: false as const,
          error: { code: 'INTERNAL_ERROR' as const, message: String(error) },
        };
      }
    },
    reconcile: async () => {
      try {
        const raw = await this.plugin()?.cacheReconcile?.();
        return {
          ok: true as const,
          value: {
            removedEntries: Number(raw?.removedEntries ?? 0),
            removedOrphans: Number(raw?.removedOrphans ?? 0),
          },
        };
      } catch (error) {
        return {
          ok: false as const,
          error: { code: 'INTERNAL_ERROR' as const, message: String(error) },
        };
      }
    },
  };

  private loadServers(): JellyfinServerView[] {
    const raw = localStorage.getItem('statocyst.jellyfin.servers');
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  private saveServers(servers: JellyfinServerView[]): void {
    localStorage.setItem('statocyst.jellyfin.servers', JSON.stringify(servers));
  }

  /**
   * Loads servers and reconciles the "Connected" badge with the stored session.
   *
   * The probe checks that the stored token can still stream media, so a working
   * session is promoted to connected even when an older build cleared the badge.
   * Network errors and servers with no library to sample keep the current state.
   */
  private async loadServersValidated(): Promise<JellyfinServerView[]> {
    const servers = this.loadServers();
    const plugin = (window as any).Capacitor?.Plugins?.['Statocyst'];
    let changed = false;
    for (const server of servers) {
      const token = localStorage.getItem(`statocyst.jellyfin.token.${server.id}`);
      const userId = localStorage.getItem(`statocyst.jellyfin.userId.${server.id}`);
      if (!token || !userId) {
        if (server.connected || server.userName) {
          server.connected = false;
          server.userName = null;
          changed = true;
        }
        continue;
      }
      try {
        // The probe is advisory and must never hold up the UI: while offline a
        // DNS lookup can hang well past any connection timeout.
        const probe = await Promise.race([
          plugin?.validateSession?.({ url: server.url, token, serverId: this.nativeServerId(server) }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_500)),
        ]);
        if (probe?.valid === true && !server.connected) {
          server.connected = true;
          changed = true;
        } else if (probe?.valid === false && server.connected) {
          server.connected = false;
          changed = true;
        }
      } catch {
        // Unreachable right now — keep the stored state.
      }
    }
    if (changed) this.saveServers(servers);
    return servers;
  }

  private markDisconnected(serverId: string): void {
    const servers = this.loadServers();
    const server = servers.find((s) => s.id === serverId);
    if (server) {
      server.connected = false;
      server.userName = null;
      this.saveServers(servers);
    }
    localStorage.removeItem(`statocyst.jellyfin.token.${serverId}`);
    localStorage.removeItem(`statocyst.jellyfin.userId.${serverId}`);
    void this.refreshNativeSession();
  }

}
