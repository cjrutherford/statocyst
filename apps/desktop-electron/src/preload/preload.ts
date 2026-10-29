import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  BRIDGE_VERSION,
  CHANNELS,
  type AppInfo,
  type CacheStats,
  type DiagnosticsInfo,
  type DownloadProgress,
  type DownloadStats,
  type DownloadSummary,
  type DownloadView,
  type EngineCommand,
  type EngineEvent,
  type EngineLoadRequest,
  type HealthCheck,
  type ImportProgress,
  type ImportSummary,
  type JellyfinQuickConnectInit,
  type JellyfinResult,
  type JellyfinServerView,
  type JellyfinSyncSummary,
  type LibraryStats,
  type PlaybackCommand,
  type PlaybackEvent,
  type PlaybackSnapshot,
  type QueueSnapshot,
  type SupportBundleResult,
  type Result,
  type Settings,
  type StatocystBridge,
  type Track,
} from '@statocyst/contracts';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const bridge: StatocystBridge = {
  bridgeVersion: BRIDGE_VERSION,
  app: {
    info: () => ipcRenderer.invoke(CHANNELS.appInfo) as Promise<AppInfo>,
    diagnostics: () =>
      ipcRenderer.invoke(CHANNELS.appDiagnostics) as Promise<DiagnosticsInfo>,
    health: () => ipcRenderer.invoke(CHANNELS.appHealth) as Promise<HealthCheck[]>,
    exportSupportBundle: () =>
      ipcRenderer.invoke(CHANNELS.appExportSupportBundle) as Promise<Result<SupportBundleResult>>,
    openDataFolder: () =>
      ipcRenderer.invoke(CHANNELS.appOpenDataFolder) as Promise<void>,
    quit: () => {
      void ipcRenderer.invoke(CHANNELS.appQuit);
    },
  },
  library: {
    pickFiles: () => ipcRenderer.invoke(CHANNELS.libraryPickFiles) as Promise<ImportSummary>,
    pickFolder: () =>
      ipcRenderer.invoke(CHANNELS.libraryPickFolder) as Promise<ImportSummary>,
    importPaths: (paths: string[]) =>
      ipcRenderer.invoke(CHANNELS.libraryImportPaths, paths) as Promise<ImportSummary>,
    importDemoLibrary: () =>
      ipcRenderer.invoke(CHANNELS.libraryImportDemo) as Promise<ImportSummary>,
    listTracks: () => ipcRenderer.invoke(CHANNELS.libraryList) as Promise<Track[]>,
    stats: () => ipcRenderer.invoke(CHANNELS.libraryStats) as Promise<LibraryStats>,
    removeTrack: (trackId: string) =>
      ipcRenderer.invoke(CHANNELS.libraryRemove, trackId) as Promise<
        Result<{ removed: boolean }>
      >,
    onImportProgress: (listener: (progress: ImportProgress) => void) =>
      subscribe<ImportProgress>(CHANNELS.libraryImportProgress, listener),
    cancelImport: () =>
      ipcRenderer.invoke(CHANNELS.libraryImportCancel) as Promise<void>,
  },
  playback: {
    getSnapshot: () =>
      ipcRenderer.invoke(CHANNELS.playbackGetSnapshot) as Promise<PlaybackSnapshot>,
    getQueue: () => ipcRenderer.invoke(CHANNELS.playbackGetQueue) as Promise<QueueSnapshot>,
    command: (command: PlaybackCommand) =>
      ipcRenderer.invoke(CHANNELS.playbackCommand, command) as Promise<
        Result<PlaybackSnapshot>
      >,
    onEvent: (listener: (event: PlaybackEvent) => void) =>
      subscribe<PlaybackEvent>(CHANNELS.playbackEvent, listener),
  },
  engine: {
    onLoad: (listener: (request: EngineLoadRequest) => void) =>
      subscribe<EngineLoadRequest>(CHANNELS.engineLoad, listener),
    onCommand: (listener: (command: EngineCommand) => void) =>
      subscribe<EngineCommand>(CHANNELS.engineCommand, listener),
    report: (event: EngineEvent) => {
      ipcRenderer.send(CHANNELS.engineEvent, event);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet) as Promise<Settings>,
    update: (patch: Partial<Settings>) =>
      ipcRenderer.invoke(CHANNELS.settingsUpdate, patch) as Promise<Settings>,
  },
  jellyfin: {
    listServers: () =>
      ipcRenderer.invoke(CHANNELS.jellyfinListServers) as Promise<JellyfinServerView[]>,
    addServer: (url: string) =>
      ipcRenderer.invoke(CHANNELS.jellyfinAddServer, url) as Promise<JellyfinResult<JellyfinServerView>>,
    login: (url: string, username: string, password: string) =>
      ipcRenderer.invoke(CHANNELS.jellyfinLogin, { url, username, password }) as Promise<
        JellyfinResult<JellyfinServerView>
      >,
    logout: (serverId: string) =>
      ipcRenderer.invoke(CHANNELS.jellyfinLogout, serverId) as Promise<
        JellyfinResult<{ removed: boolean }>
      >,
    removeServer: (serverId: string) =>
      ipcRenderer.invoke(CHANNELS.jellyfinRemoveServer, serverId) as Promise<
        JellyfinResult<{ removed: boolean }>
      >,
    sync: (serverId: string) =>
      ipcRenderer.invoke(CHANNELS.jellyfinSync, serverId) as Promise<JellyfinResult<JellyfinSyncSummary>>,
    initiateQuickConnect: (url: string) =>
      ipcRenderer.invoke(CHANNELS.jellyfinQuickConnectInitiate, url) as Promise<
        JellyfinResult<JellyfinQuickConnectInit>
      >,
    pollQuickConnect: (url: string, secret: string) =>
      ipcRenderer.invoke(CHANNELS.jellyfinQuickConnectPoll, { url, secret }) as Promise<
        JellyfinResult<{ authenticated: boolean }>
      >,
    loginWithQuickConnect: (url: string, secret: string) =>
      ipcRenderer.invoke(CHANNELS.jellyfinQuickConnectLogin, { url, secret }) as Promise<
        JellyfinResult<JellyfinServerView>
      >,
    encryptionAvailable: () =>
      ipcRenderer.invoke(CHANNELS.jellyfinEncryptionAvailable) as Promise<boolean>,
  },
  downloads: {
    download: (trackId: string) =>
      ipcRenderer.invoke(CHANNELS.downloadAdd, trackId) as Promise<Result<DownloadSummary>>,
    remove: (trackId: string) =>
      ipcRenderer.invoke(CHANNELS.downloadRemove, trackId) as Promise<Result<{ removed: boolean }>>,
    list: () => ipcRenderer.invoke(CHANNELS.downloadList) as Promise<DownloadView[]>,
    stats: () => ipcRenderer.invoke(CHANNELS.downloadStats) as Promise<DownloadStats>,
    onProgress: (listener: (progress: DownloadProgress) => void) =>
      subscribe<DownloadProgress>(CHANNELS.downloadProgress, listener),
  },
  cache: {
    stats: () => ipcRenderer.invoke(CHANNELS.cacheStats) as Promise<CacheStats>,
    clear: () =>
      ipcRenderer.invoke(CHANNELS.cacheClear) as Promise<Result<{ removed: number }>>,
    reconcile: () =>
      ipcRenderer.invoke(CHANNELS.cacheReconcile) as Promise<
        Result<{ removedEntries: number; removedOrphans: number }>
      >,
  },
};

contextBridge.exposeInMainWorld('statocyst', bridge);
