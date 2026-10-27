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

export interface Settings {
  theme: ThemePreference;
  density: DensityPreference;
  volume: number;
  muted: boolean;
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
  schemaVersion: number;
  integrity: 'ok' | 'failed' | 'unknown';
  queueEntries: number;
  trackCount: number;
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
  openDataFolder(): Promise<void>;
  quit(): void;
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
  | 'INTERNAL_ERROR';

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
