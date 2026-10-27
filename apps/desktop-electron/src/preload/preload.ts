import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  BRIDGE_VERSION,
  CHANNELS,
  type AppInfo,
  type DiagnosticsInfo,
  type EngineCommand,
  type EngineEvent,
  type EngineLoadRequest,
  type ImportSummary,
  type LibraryStats,
  type PlaybackCommand,
  type PlaybackEvent,
  type PlaybackSnapshot,
  type QueueSnapshot,
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
};

contextBridge.exposeInMainWorld('statocyst', bridge);
