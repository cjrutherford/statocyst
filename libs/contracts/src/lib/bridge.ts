import type {
  CommandError,
  PlaybackCommand,
  PlaybackEvent,
  PlaybackSnapshot,
  QueueSnapshot,
  Result,
  Track,
} from './playback';

export const BRIDGE_VERSION = 1 as const;

export type ThemePreference = 'system' | 'dark' | 'light';
export type DensityPreference = 'comfortable' | 'compact';
export type QualityPreference = 'lossless' | 'auto';

export interface Settings {
  theme: ThemePreference;
  density: DensityPreference;
  volume: number;
  muted: boolean;
  /** Rolling-cache budget in bytes (evictable; never touches protected downloads). */
  cacheBudgetBytes: number;
  /** Lossless prefers direct-play; auto allows policy-driven transcoding. */
  quality: QualityPreference;
  /**
   * Local-only listening history (play counts, last-played). Off by default so
   * derived listening data is opt-in (ADR-015). Never sent off the device.
   */
  listeningHistory: boolean;
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  dataPath: string;
  databasePath: string;
  logPath: string;
  packaged: boolean;
}

export interface ImportRejection {
  path: string;
  code: string;
  message: string;
}

export interface ImportSummary {
  sourceId: string | null;
  sourceLabel: string | null;
  imported: number;
  duplicates: number;
  missing: number;
  rejected: ImportRejection[];
  tracks: Track[];
  cancelled: boolean;
}

export interface LibraryStats {
  tracks: number;
  albums: number;
  artists: number;
  durationMs: number;
  missing: number;
}

export interface DiagnosticsInfo {
  databasePath: string;
  logPath: string;
  databaseBytes: number;
  cacheBytes: number;
  schemaVersion: number;
  integrity: 'ok' | 'failed' | 'unknown';
  queueEntries: number;
  trackCount: number;
}

export type HealthStatus = 'ok' | 'warn' | 'fail';

export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  /** Short human-readable result, safe to include in an exported bundle. */
  detail: string;
}

export interface SupportBundleResult {
  /** Absolute path written, or null when the user cancelled the dialog. */
  path: string | null;
  bytes: number;
}

export interface EngineLoadRequest {
  token: number;
  entryId: string;
  trackId: string;
  url: string;
  autoplay: boolean;
  startPositionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
}

export type EngineState = 'playing' | 'paused' | 'buffering';

export type EngineCommand =
  | { token: number; action: 'play' }
  | { token: number; action: 'pause' }
  | { token: number; action: 'seek'; positionMs: number }
  | { token: number; action: 'volume'; volume: number; muted: boolean };

export type EngineEvent =
  | { type: 'ready'; token: number; durationMs: number }
  | { type: 'state'; token: number; state: EngineState }
  | { type: 'time'; token: number; positionMs: number; durationMs: number }
  | { type: 'health'; token: number; bufferSeconds: number }
  | { type: 'ended'; token: number }
  | { type: 'error'; token: number; code: string; message: string };

export interface ImportProgress {
  phase: 'scanning' | 'importing';
  /** Files inspected for metadata so far (scanning phase only). */
  scanned: number;
  /** Total audio files discovered, or null until the directory walk completes. */
  total: number | null;
  /** Tracks written to the catalog so far (importing phase only). */
  imported: number;
  /** Path being processed right now, or null. */
  currentPath: string | null;
}

export interface LibraryBridge {
  pickFiles(): Promise<ImportSummary>;
  pickFolder(): Promise<ImportSummary>;
  importPaths(paths: string[]): Promise<ImportSummary>;
  importDemoLibrary(): Promise<ImportSummary>;
  listTracks(): Promise<Track[]>;
  stats(): Promise<LibraryStats>;
  removeTrack(trackId: string): Promise<Result<{ removed: boolean }>>;
  onImportProgress(listener: (progress: ImportProgress) => void): () => void;
  cancelImport(): Promise<void>;
}

export interface PlaybackBridge {
  getSnapshot(): Promise<PlaybackSnapshot>;
  getQueue(): Promise<QueueSnapshot>;
  command(command: PlaybackCommand): Promise<Result<PlaybackSnapshot>>;
  onEvent(listener: (event: PlaybackEvent) => void): () => void;
}

export interface EngineBridge {
  onLoad(listener: (request: EngineLoadRequest) => void): () => void;
  onCommand(listener: (command: EngineCommand) => void): () => void;
  report(event: EngineEvent): void;
}

export interface SettingsBridge {
  get(): Promise<Settings>;
  update(patch: Partial<Settings>): Promise<Settings>;
}

export interface AppBridge {
  info(): Promise<AppInfo>;
  diagnostics(): Promise<DiagnosticsInfo>;
  health(): Promise<HealthCheck[]>;
  /** Writes a redacted diagnostics bundle through a native save dialog. */
  exportSupportBundle(): Promise<Result<SupportBundleResult>>;
  openDataFolder(): Promise<void>;
  quit(): void;
}

export interface DownloadView {
  trackId: string;
  localPath: string;
  sizeBytes: number;
  sha256: string;
  container: string | null;
  verified: boolean;
  createdAt: string;
}

export interface DownloadProgress {
  trackId: string;
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
  error: string | null;
}

export interface DownloadSummary {
  trackId: string;
  sizeBytes: number;
  sha256: string;
  verified: boolean;
}

export interface DownloadStats {
  count: number;
  totalBytes: number;
}

export type DownloadQueueState = 'queued' | 'active' | 'retrying' | 'waiting' | 'failed' | 'done';

export interface DownloadQueueEntry {
  trackId: string;
  state: DownloadQueueState;
  receivedBytes: number;
  totalBytes: number | null;
  /** Retry attempt in progress (0 when none). */
  attempt: number;
  /** Last error: the failure reason, or the transient problem being retried. */
  error: string | null;
}

/** The whole native download queue: per-track state plus aggregate progress. */
export interface DownloadQueueSnapshot {
  total: number;
  done: number;
  failed: number;
  pending: number;
  /** Nothing left to do (every track is done or failed). */
  finished: boolean;
  receivedBytes: number;
  /** Sum of known sizes, or null before any size is known. */
  totalBytes: number | null;
  /** True once every unfinished track has reported its size, so byte progress is trustworthy. */
  sizesKnown: boolean;
  entries: DownloadQueueEntry[];
}

export interface DownloadsBridge {
  /**
   * Native background queue (Android): downloads keep running with the screen off,
   * retry and resume after network drops. Absent where downloads run one by one.
   */
  enqueue?(trackIds: string[]): Promise<DownloadQueueSnapshot>;
  cancelQueue?(): Promise<DownloadQueueSnapshot>;
  retryFailed?(): Promise<DownloadQueueSnapshot>;
  dismissQueue?(): Promise<DownloadQueueSnapshot>;
  queue?(): Promise<DownloadQueueSnapshot>;
  onQueue?(listener: (snapshot: DownloadQueueSnapshot) => void): () => void;
  /**
   * False when this runtime cannot store protected downloads (the Android
   * build today). Omitted means supported, so existing bridges need no change.
   */
  readonly supported?: boolean;
  /** Downloads a track to the protected (non-evictable) store and verifies it. */
  download(trackId: string): Promise<Result<DownloadSummary>>;
  remove(trackId: string): Promise<Result<{ removed: boolean }>>;
  list(): Promise<DownloadView[]>;
  stats(): Promise<DownloadStats>;
  onProgress(listener: (progress: DownloadProgress) => void): () => void;
}

export interface CacheStats {
  /** Bytes currently held by the evictable rolling cache. */
  bytes: number;
  /** Effective budget in bytes (may be reduced under storage pressure). */
  budgetBytes: number;
  entries: number;
  /** Sent when the storage-pressure handler reduces the budget. */
  pressure: boolean;
}

export interface CacheBridge {
  stats(): Promise<CacheStats>;
  clear(): Promise<Result<{ removed: number }>>;
  reconcile(): Promise<Result<{ removedEntries: number; removedOrphans: number }>>;
}

export type JellyfinErrorCode =
  | 'INVALID_URL'
  | 'NOT_HTTPS'
  | 'UNREACHABLE'
  | 'NOT_JELLYFIN'
  | 'AUTH_FAILED'
  | 'UNAUTHORIZED'
  | 'IDENTITY_MISMATCH'
  | 'CREDENTIAL_STORAGE_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'NOT_IMPLEMENTED';

export interface JellyfinError {
  code: JellyfinErrorCode;
  message: string;
}

export type JellyfinResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: JellyfinError };

export interface JellyfinServerView {
  id: string;
  url: string;
  name: string;
  jellyfinId: string;
  version: string | null;
  connected: boolean;
  userName: string | null;
}

export interface JellyfinSyncSummary {
  serverId: string;
  total: number;
  imported: number;
  updated: number;
}

export interface JellyfinQuickConnectInit {
  secret: string;
  code: string;
}

export interface JellyfinBridge {
  listServers(): Promise<JellyfinServerView[]>;
  addServer(url: string): Promise<JellyfinResult<JellyfinServerView>>;
  login(url: string, username: string, password: string): Promise<JellyfinResult<JellyfinServerView>>;
  logout(serverId: string): Promise<JellyfinResult<{ removed: boolean }>>;
  removeServer(serverId: string): Promise<JellyfinResult<{ removed: boolean }>>;
  sync(serverId: string): Promise<JellyfinResult<JellyfinSyncSummary>>;
  initiateQuickConnect(url: string): Promise<JellyfinResult<JellyfinQuickConnectInit>>;
  pollQuickConnect(url: string, secret: string): Promise<JellyfinResult<{ authenticated: boolean }>>;
  loginWithQuickConnect(url: string, secret: string): Promise<JellyfinResult<JellyfinServerView>>;
  encryptionAvailable(): Promise<boolean>;
}

export interface ElectronBridgeError {
  code: string;
  message: string;
}

/**
 * The complete surface exposed by the Electron preload to the Angular renderer.
 * No Node, filesystem or shell primitive is exposed directly.
 */
export interface StatocystBridge {
  bridgeVersion: typeof BRIDGE_VERSION;
  app: AppBridge;
  library: LibraryBridge;
  playback: PlaybackBridge;
  engine: EngineBridge;
  settings: SettingsBridge;
  jellyfin: JellyfinBridge;
  downloads: DownloadsBridge;
  cache: CacheBridge;
  /** Song radio (Android): the seed first, then similar songs. Absent on desktop. */
  radio?(request: { trackId: string; limit?: number }): Promise<{ trackIds: string[]; source: string }>;
  /** Android Auto browse access: controllers the user allowed and ones that were denied. Absent on desktop. */
  getBrowseAccess?(): Promise<BrowseAccess>;
  setBrowseAllowed?(request: { packageName: string; allowed: boolean }): Promise<BrowseAccess>;
  /** Opt-in MusicBrainz / Cover Art Archive artwork for tracks without art (Android). Absent on desktop. */
  getExternalArtwork?(): Promise<{ enabled: boolean }>;
  setExternalArtwork?(request: { enabled: boolean }): Promise<{ enabled: boolean }>;
}

export interface BrowseAccess {
  allowed: string[];
  denied: string[];
}

export function toBridgeError(error: unknown): ElectronBridgeError {
  if (error && typeof error === 'object' && 'message' in error) {
    const typed = error as CommandError;
    return {
      code: typeof typed.code === 'string' ? typed.code : 'INTERNAL_ERROR',
      message: typeof typed.message === 'string' ? typed.message : String(error),
    };
  }
  return { code: 'INTERNAL_ERROR', message: String(error) };
}
