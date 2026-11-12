import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  BRIDGE_VERSION,
  CHANNELS,
  type AppInfo,
  type CacheStats,
  type DiagnosticsInfo,
  type DownloadProfile,
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
  type PodcastDownloadVariant,
  type PlaybackSnapshot,
  type QueueSnapshot,
  type SupportBundleResult,
  type Result,
  type Settings,
  type StatocystBridge,
  type Track,
  type PodcastChangeEvent,
  type PodcastDirectoryStatus,
  type PodcastDiscovery,
  type PodcastEpisode,
  type PodcastFeed,
  type PodcastFeedPatch,
  type PodcastImportSummary,
  type PodcastRefreshSummary,
  type PodcastSearchResult,
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
    openExternal: (url: string) =>
      ipcRenderer.invoke(CHANNELS.appOpenExternal, url) as Promise<Result<{ opened: boolean }>>,
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
    // Desktop artwork is embedded in the files; Android/iOS clear their engine caches.
    reanalyzeArtwork: async () => ({ cleared: 0, generation: 0 }),
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
    getSnapshot: (context) =>
      ipcRenderer.invoke(CHANNELS.playbackGetSnapshot, context) as Promise<PlaybackSnapshot>,
    getQueue: (context) =>
      ipcRenderer.invoke(CHANNELS.playbackGetQueue, context) as Promise<QueueSnapshot>,
    command: (command: PlaybackCommand, context) =>
      ipcRenderer.invoke(CHANNELS.playbackCommand, { command, context }) as Promise<
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
  podcast: {
    listFeeds: () =>
      ipcRenderer.invoke(CHANNELS.podcastListFeeds) as Promise<PodcastFeed[]>,
    addFeed: (url: string, options?: { artworkUrl?: string | null }) =>
      ipcRenderer.invoke(CHANNELS.podcastAddFeed, {
        url,
        artworkUrl: options?.artworkUrl ?? null,
      }) as Promise<Result<PodcastFeed>>,
    updateFeed: (feedId: string, patch: PodcastFeedPatch) =>
      ipcRenderer.invoke(CHANNELS.podcastUpdateFeed, { feedId, patch }) as Promise<
        Result<PodcastFeed>
      >,
    removeFeed: (feedId: string, options?: { deleteDownloads?: boolean }) =>
      ipcRenderer.invoke(CHANNELS.podcastRemoveFeed, { feedId, options }) as Promise<
        Result<{ removed: boolean }>
      >,
    refresh: (feedId?: string) =>
      ipcRenderer.invoke(CHANNELS.podcastRefresh, feedId) as Promise<PodcastRefreshSummary>,
    listEpisodes: (
      feedId: string,
      options?: { limit?: number; offset?: number; sort?: 'newest' | 'oldest' },
    ) =>
      ipcRenderer.invoke(CHANNELS.podcastListEpisodes, { feedId, options }) as Promise<
        PodcastEpisode[]
      >,
    getEpisode: (episodeId: string) =>
      ipcRenderer.invoke(CHANNELS.podcastGetEpisode, episodeId) as Promise<PodcastEpisode | null>,
    setPlayed: (episodeId: string, played: boolean) =>
      ipcRenderer.invoke(CHANNELS.podcastSetPlayed, { episodeId, played }) as Promise<
        Result<PodcastEpisode>
      >,
    searchDirectory: (query: string) =>
      ipcRenderer.invoke(CHANNELS.podcastSearchDirectory, query) as Promise<
        Result<PodcastSearchResult[]>
      >,
    cacheArtwork: (url: string) =>
      ipcRenderer.invoke(CHANNELS.podcastCacheArtwork, url) as Promise<
        Result<{ url: string | null }>
      >,
    discover: () =>
      ipcRenderer.invoke(CHANNELS.podcastDiscover) as Promise<Result<PodcastDiscovery>>,
    directoryStatus: () =>
      ipcRenderer.invoke(CHANNELS.podcastDirectoryStatus) as Promise<PodcastDirectoryStatus>,
    setDirectoryCredentials: (apiKey: string, secret: string) =>
      ipcRenderer.invoke(CHANNELS.podcastSetDirectoryCredentials, { apiKey, secret }) as Promise<
        Result<PodcastDirectoryStatus>
      >,
    clearDirectoryCredentials: () =>
      ipcRenderer.invoke(CHANNELS.podcastClearDirectoryCredentials) as Promise<void>,
    importOpml: () =>
      ipcRenderer.invoke(CHANNELS.podcastImportOpml) as Promise<PodcastImportSummary>,
    exportOpml: () =>
      ipcRenderer.invoke(CHANNELS.podcastExportOpml) as Promise<
        Result<{ path: string | null; bytes: number }>
      >,
    onChanged: (listener: (event: PodcastChangeEvent) => void) =>
      subscribe<PodcastChangeEvent>(CHANNELS.podcastChanged, listener),
  },
  downloads: {
    download: (trackId: string, _profile?: DownloadProfile, variant?: PodcastDownloadVariant) =>
      ipcRenderer.invoke(CHANNELS.downloadAdd, trackId, variant) as Promise<
        Result<DownloadSummary>
      >,
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
