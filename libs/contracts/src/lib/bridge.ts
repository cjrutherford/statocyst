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

export interface LibraryBridge {
  pickFiles(): Promise<ImportSummary>;
  pickFolder(): Promise<ImportSummary>;
  importPaths(paths: string[]): Promise<ImportSummary>;
  importDemoLibrary(): Promise<ImportSummary>;
  listTracks(): Promise<Track[]>;
  stats(): Promise<LibraryStats>;
  removeTrack(trackId: string): Promise<Result<{ removed: boolean }>>;
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
