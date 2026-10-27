import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { stat } from 'node:fs/promises';
import type {
  AppInfo,
  DiagnosticsInfo,
  ImportSummary,
  Result,
  Settings,
} from '@statocyst/contracts';
import { CHANNELS, fail, ok } from '@statocyst/contracts';
import { SUPPORTED_AUDIO_EXTENSIONS } from '@statocyst/media-library';
import type { StatocystDatabase } from '@statocyst/persistence';
import type { LibraryService } from './library-service';
import type { Logger } from './logger';
import type { PlaybackService } from './playback-service';
import type { SettingsService } from './settings-service';

export interface IpcContext {
  getWindow: () => BrowserWindow | null;
  database: StatocystDatabase;
  databasePath: string;
  logPath: string;
  dataDirectory: string;
  demoDirectory: string;
  library: LibraryService;
  playback: PlaybackService;
  settings: SettingsService;
  logger: Logger;
  version: string;
  packaged: boolean;
}

function emptySummary(cancelled: boolean): ImportSummary {
  return {
    sourceId: null,
    sourceLabel: null,
    imported: 0,
    duplicates: 0,
    missing: 0,
    rejected: [],
    tracks: [],
    cancelled,
  };
}

export function appInfo(context: IpcContext): AppInfo {
  return {
    name: 'Statocyst',
    version: context.version,
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    dataPath: context.dataDirectory,
    databasePath: context.databasePath,
    logPath: context.logPath,
    packaged: context.packaged,
  };
}

async function diagnostics(context: IpcContext): Promise<DiagnosticsInfo> {
  const [dbStat, integrity, schemaVersion, queueEntries, stats] = await Promise.all([
    stat(context.databasePath).catch(() => null),
    context.database.integrityCheck().catch(() => 'unknown' as const),
    context.database.schemaVersion().catch(() => 0),
    context.database.countQueueEntries().catch(() => 0),
    context.database.stats().catch(() => ({
      tracks: 0,
      albums: 0,
      artists: 0,
      durationMs: 0,
      missing: 0,
    })),
  ]);
  return {
    databasePath: context.databasePath,
    logPath: context.logPath,
    databaseBytes: dbStat?.size ?? 0,
    schemaVersion,
    integrity,
    queueEntries,
    trackCount: stats.tracks,
  };
}

export function registerIpc(context: IpcContext): void {
  const assertSender = (event: IpcMainInvokeEvent): void => {
    const window = context.getWindow();
    if (!window || window.isDestroyed() || event.sender.id !== window.webContents.id) {
      throw new Error('Rejected IPC call from an unexpected renderer');
    }
  };

  const handle = (
    channel: string,
    listener: (...args: unknown[]) => unknown,
  ): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      assertSender(event);
      return listener(...args);
    });
  };

  handle(CHANNELS.appInfo, () => appInfo(context));

  handle(CHANNELS.appDiagnostics, () => diagnostics(context));

  handle(CHANNELS.appOpenDataFolder, async () => {
    const error = await shell.openPath(context.dataDirectory);
    if (error) context.logger.warn('app.open-data-folder.failed', { error });
  });

  handle(CHANNELS.appQuit, () => {
    app.quit();
  });

  handle(CHANNELS.libraryPickFiles, async () => {
    const window = context.getWindow();
    if (!window) return emptySummary(true);
    const result = await dialog.showOpenDialog(window, {
      title: 'Import audio files',
      buttonLabel: 'Import',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio', extensions: [...SUPPORTED_AUDIO_EXTENSIONS] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return emptySummary(true);
    return context.library.importPaths(result.filePaths, 'local');
  });

  handle(CHANNELS.libraryPickFolder, async () => {
    const window = context.getWindow();
    if (!window) return emptySummary(true);
    const result = await dialog.showOpenDialog(window, {
      title: 'Import a music folder',
      buttonLabel: 'Import folder',
      properties: ['openDirectory', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return emptySummary(true);
    return context.library.importPaths(result.filePaths, 'local');
  });

  handle(CHANNELS.libraryImportPaths, async (paths: unknown) => {
    if (!Array.isArray(paths) || paths.length === 0) return emptySummary(false);
    return context.library.importPaths(paths.slice(0, 10_000).map(String), 'local');
  });

  handle(CHANNELS.libraryImportDemo, async () => {
    return context.library.importPaths([context.demoDirectory], 'demo');
  });

  handle(CHANNELS.libraryList, () => context.library.listTracks());

  handle(CHANNELS.libraryStats, () => context.library.stats());

  handle(
    CHANNELS.libraryRemove,
    async (trackId: unknown): Promise<Result<{ removed: boolean }>> => {
      if (typeof trackId !== 'string' || trackId.length === 0) {
        return fail('INVALID_ARGUMENT', 'trackId must be a non-empty string');
      }
      const removed = await context.library.removeTrack(trackId);
      if (removed) {
        await context.playback.syncLibrary('track-removed');
      }
      return ok({ removed });
    },
  );

  handle(CHANNELS.playbackGetSnapshot, () => context.playback.getSnapshot());

  handle(CHANNELS.playbackGetQueue, () => context.playback.getQueue());

  handle(CHANNELS.playbackCommand, (command: unknown) => context.playback.command(command));

  handle(CHANNELS.settingsGet, () => context.settings.get());

  handle(
    CHANNELS.settingsUpdate,
    async (patch: unknown): Promise<Settings> => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return context.settings.get();
      }
      return context.settings.update(patch as Partial<Settings>);
    },
  );

  ipcMain.on(CHANNELS.engineEvent, (event, payload: unknown) => {
    const window = context.getWindow();
    if (!window || window.isDestroyed() || event.sender.id !== window.webContents.id) return;
    context.playback.engineEvent(payload);
  });

  context.logger.info('ipc.registered');
}
