import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AppInfo,
  DiagnosticsInfo,
  HealthCheck,
  ImportProgress,
  ImportSummary,
  PodcastEpisode,
  PodcastFeed,
  PodcastFeedPatch,
  PodcastImportSummary,
  Result,
  Settings,
  SupportBundleResult,
} from '@statocyst/contracts';
import { CHANNELS, fail, ok } from '@statocyst/contracts';
import { checkHttpUrl } from '@statocyst/podcast-core';
import { SUPPORTED_AUDIO_EXTENSIONS } from '@statocyst/media-library';
import type { StatocystDatabase } from '@statocyst/persistence';
import { buildSupportBundle, collectHealth } from './support';
import type { LibraryService } from './library-service';
import type { DownloadService } from './download-service';
import type { CacheManager } from './cache-manager';
import type { Logger } from './logger';
import type { PlaybackService } from './playback-service';
import type { SettingsService } from './settings-service';
import type { JellyfinService } from './jellyfin-service';
import type { PodcastService } from './podcast-service';

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
  jellyfin: JellyfinService;
  podcast: PodcastService;
  downloads: DownloadService;
  cache: CacheManager;
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

function isPlaybackContext(value: unknown): value is 'music' | 'podcast' {
  return value === 'music' || value === 'podcast';
}

const IMPORT_CONCURRENCY = (() => {
  const raw = Number(process.env['STATOCYST_IMPORT_CONCURRENCY']);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 4;
})();

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
  const [dbStat, integrity, schemaVersion, queueEntries, stats, cacheStats] = await Promise.all([
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
    context.cache.stats().catch(() => ({ bytes: 0, budgetBytes: 0, entries: 0, pressure: false })),
  ]);
  return {
    databasePath: context.databasePath,
    logPath: context.logPath,
    databaseBytes: dbStat?.size ?? 0,
    cacheBytes: cacheStats.bytes,
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

  let activeImport: AbortController | null = null;

  const sendImportProgress = (progress: ImportProgress): void => {
    const window = context.getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(CHANNELS.libraryImportProgress, progress);
    }
  };

  const beginImport = (): AbortController => {
    activeImport?.abort();
    const controller = new AbortController();
    activeImport = controller;
    return controller;
  };

  const runImport = (
    run: (options: {
      signal: AbortSignal;
      onProgress: (progress: ImportProgress) => void;
    }) => Promise<ImportSummary>,
  ): Promise<ImportSummary> => {
    const controller = beginImport();
    return run({ signal: controller.signal, onProgress: sendImportProgress }).finally(() => {
      if (activeImport === controller) activeImport = null;
    });
  };

  handle(CHANNELS.libraryImportCancel, async () => {
    activeImport?.abort();
  });

  handle(CHANNELS.appInfo, () => appInfo(context));

  handle(CHANNELS.appDiagnostics, () => diagnostics(context));

  handle(CHANNELS.appHealth, (): Promise<HealthCheck[]> =>
    collectHealth({
      database: context.database,
      dataDirectory: context.dataDirectory,
      logPath: context.logPath,
      cacheBudgetBytes: context.settings.get().cacheBudgetBytes,
    }),
  );

  handle(CHANNELS.appExportSupportBundle, async (): Promise<Result<SupportBundleResult>> => {
    const window = context.getWindow();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const options = {
      title: 'Export support bundle',
      defaultPath: join(context.dataDirectory, `statocyst-support-${stamp}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return ok({ path: null, bytes: 0 });

    // Flush queued writes so the bundle reflects the events that just occurred.
    await context.logger.flush();
    const [health, logText, info, diag] = await Promise.all([
      collectHealth({
        database: context.database,
        dataDirectory: context.dataDirectory,
        logPath: context.logPath,
        cacheBudgetBytes: context.settings.get().cacheBudgetBytes,
      }),
      readFile(context.logPath, 'utf8').catch(() => ''),
      Promise.resolve(appInfo(context)),
      diagnostics(context),
    ]);
    const bundle = buildSupportBundle({
      app: info,
      diagnostics: diag,
      settings: context.settings.get(),
      health,
      logText,
    });
    try {
      await writeFile(result.filePath, bundle, 'utf8');
    } catch (error) {
      context.logger.warn('support.bundle.write.failed', { error });
      return fail('INTERNAL_ERROR', 'Could not write the support bundle');
    }
    const bytes = Buffer.byteLength(bundle);
    context.logger.info('support.bundle.exported', { path: result.filePath, bytes });
    return ok({ path: result.filePath, bytes });
  });

  handle(CHANNELS.appOpenDataFolder, async () => {
    const error = await shell.openPath(context.dataDirectory);
    if (error) context.logger.warn('app.open-data-folder.failed', { error });
  });

  handle(
    CHANNELS.appOpenExternal,
    async (url: unknown): Promise<Result<{ opened: boolean }>> => {
      if (typeof url !== 'string') {
        return fail('INVALID_ARGUMENT', 'A URL is required');
      }
      const checked = checkHttpUrl(url);
      if (!checked.ok) return fail('INVALID_ARGUMENT', checked.message);
      try {
        await shell.openExternal(checked.url.toString());
        return ok({ opened: true });
      } catch (error) {
        context.logger.warn('app.open-external.failed', {
          host: checked.url.host,
          error: error instanceof Error ? error.message : String(error),
        });
        return fail('INTERNAL_ERROR', 'The link could not be opened');
      }
    },
  );

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
    return runImport((options) =>
      context.library.importPaths(result.filePaths, 'local', { ...options, maxConcurrency: IMPORT_CONCURRENCY }),
    );
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
    return runImport((options) =>
      context.library.importPaths(result.filePaths, 'local', { ...options, maxConcurrency: IMPORT_CONCURRENCY }),
    );
  });

  handle(CHANNELS.libraryImportPaths, async (paths: unknown) => {
    if (!Array.isArray(paths) || paths.length === 0) return emptySummary(false);
    const resolved = paths.slice(0, 10_000).map(String);
    return runImport((options) =>
      context.library.importPaths(resolved, 'local', { ...options, maxConcurrency: IMPORT_CONCURRENCY }),
    );
  });

  handle(CHANNELS.libraryImportDemo, async () => {
    return runImport((options) =>
      context.library.importPaths([context.demoDirectory], 'demo', { ...options, maxConcurrency: IMPORT_CONCURRENCY }),
    );
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

  handle(CHANNELS.playbackGetSnapshot, (playbackContext: unknown) =>
    context.playback.getSnapshot(isPlaybackContext(playbackContext) ? playbackContext : 'music'),
  );

  handle(CHANNELS.playbackGetQueue, (playbackContext: unknown) =>
    context.playback.getQueue(isPlaybackContext(playbackContext) ? playbackContext : 'music'),
  );

  handle(CHANNELS.playbackCommand, (args: unknown) => {
    const input = (args ?? {}) as { command?: unknown; context?: unknown };
    if (input.command === undefined) {
      return fail('INVALID_ARGUMENT', 'A playback command is required');
    }
    return context.playback.command(
      input.command,
      isPlaybackContext(input.context) ? input.context : 'music',
    );
  });

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

  handle(CHANNELS.jellyfinListServers, () => context.jellyfin.listServers());

  handle(CHANNELS.jellyfinAddServer, (url: unknown) => context.jellyfin.addServer(String(url ?? '')));

  handle(CHANNELS.jellyfinLogin, (args: unknown) => {
    const input = (args ?? {}) as { url?: unknown; username?: unknown; password?: unknown };
    return context.jellyfin.login(
      String(input.url ?? ''),
      String(input.username ?? ''),
      String(input.password ?? ''),
    );
  });

  handle(CHANNELS.jellyfinLogout, (serverId: unknown) => context.jellyfin.logout(String(serverId ?? '')));

  handle(CHANNELS.jellyfinRemoveServer, (serverId: unknown) =>
    context.jellyfin.removeServer(String(serverId ?? '')),
  );

  handle(CHANNELS.jellyfinSync, (serverId: unknown) => context.jellyfin.syncCatalog(String(serverId ?? '')));

  handle(CHANNELS.jellyfinQuickConnectInitiate, (url: unknown) => context.jellyfin.initiateQuickConnect(String(url ?? '')));

  handle(CHANNELS.jellyfinQuickConnectPoll, (args: unknown) => {
    const input = (args ?? {}) as { url?: unknown; secret?: unknown };
    return context.jellyfin.pollQuickConnect(String(input.url ?? ''), String(input.secret ?? ''));
  });

  handle(CHANNELS.jellyfinQuickConnectLogin, (args: unknown) => {
    const input = (args ?? {}) as { url?: unknown; secret?: unknown };
    return context.jellyfin.loginWithQuickConnect(String(input.url ?? ''), String(input.secret ?? ''));
  });

  handle(CHANNELS.jellyfinEncryptionAvailable, () => context.jellyfin.encryptionAvailable());

  const emptyPodcastImport = (): PodcastImportSummary => ({
    added: 0,
    duplicates: 0,
    invalid: 0,
    scheduled: 0,
    feeds: [],
  });

  handle(CHANNELS.podcastListFeeds, () => context.podcast.listFeeds());

  handle(CHANNELS.podcastAddFeed, (args: unknown) => {
    const input =
      typeof args === 'string'
        ? { url: args, artworkUrl: null }
        : ((args ?? {}) as { url?: unknown; artworkUrl?: unknown });
    if (typeof input.url !== 'string' || input.url.trim().length === 0) {
      return fail<PodcastFeed>('INVALID_ARGUMENT', 'A feed URL is required');
    }
    return context.podcast.addFeed(
      input.url,
      typeof input.artworkUrl === 'string' ? { artworkUrl: input.artworkUrl } : undefined,
    );
  });

  handle(CHANNELS.podcastUpdateFeed, (args: unknown) => {
    const input = (args ?? {}) as { feedId?: unknown; patch?: unknown };
    if (typeof input.feedId !== 'string' || input.feedId.length === 0) {
      return fail<PodcastFeed>('INVALID_ARGUMENT', 'feedId is required');
    }
    if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) {
      return fail<PodcastFeed>('INVALID_ARGUMENT', 'A feed settings patch is required');
    }
    return context.podcast.updateFeed(input.feedId, input.patch as PodcastFeedPatch);
  });

  handle(CHANNELS.podcastRemoveFeed, (args: unknown) => {
    const input = (args ?? {}) as { feedId?: unknown; options?: unknown };
    if (typeof input.feedId !== 'string' || input.feedId.length === 0) {
      return fail<{ removed: boolean }>('INVALID_ARGUMENT', 'feedId is required');
    }
    const options =
      input.options && typeof input.options === 'object' && !Array.isArray(input.options)
        ? (input.options as { deleteDownloads?: boolean })
        : {};
    return context.podcast.removeFeed(input.feedId, options);
  });

  handle(CHANNELS.podcastRefresh, (feedId: unknown) =>
    context.podcast.refresh(typeof feedId === 'string' && feedId.length > 0 ? feedId : undefined),
  );

  handle(CHANNELS.podcastListEpisodes, (args: unknown) => {
    const input = (args ?? {}) as {
      feedId?: unknown;
      options?: { limit?: unknown; offset?: unknown; sort?: unknown };
    };
    if (typeof input.feedId !== 'string' || input.feedId.length === 0) {
      return Promise.resolve([] as PodcastEpisode[]);
    }
    const options: { limit?: number; offset?: number; sort?: 'newest' | 'oldest' } = {};
    if (typeof input.options?.limit === 'number') options.limit = input.options.limit;
    if (typeof input.options?.offset === 'number') options.offset = input.options.offset;
    if (input.options?.sort === 'newest' || input.options?.sort === 'oldest') {
      options.sort = input.options.sort;
    }
    return context.podcast.listEpisodes(input.feedId, options);
  });

  handle(CHANNELS.podcastGetEpisode, (episodeId: unknown) =>
    context.podcast.getEpisode(typeof episodeId === 'string' ? episodeId : ''),
  );

  handle(CHANNELS.podcastSetPlayed, (args: unknown) => {
    const input = (args ?? {}) as { episodeId?: unknown; played?: unknown };
    if (typeof input.episodeId !== 'string' || input.episodeId.length === 0) {
      return fail<PodcastEpisode>('INVALID_ARGUMENT', 'episodeId is required');
    }
    return context.podcast.setPlayed(input.episodeId, input.played === true);
  });

  handle(CHANNELS.podcastSearchDirectory, (query: unknown) =>
    context.podcast.searchDirectory(typeof query === 'string' ? query : ''),
  );

  handle(CHANNELS.podcastDiscover, () => context.podcast.discoverDirectory());

  handle(CHANNELS.podcastCacheArtwork, (url: unknown) =>
    context.podcast.cacheDirectoryArtwork(typeof url === 'string' ? url : ''),
  );

  handle(CHANNELS.podcastDirectoryStatus, () => context.podcast.directoryStatus());

  handle(CHANNELS.podcastSetDirectoryCredentials, (args: unknown) => {
    const input = (args ?? {}) as { apiKey?: unknown; secret?: unknown };
    return context.podcast.setDirectoryCredentials(
      typeof input.apiKey === 'string' ? input.apiKey : '',
      typeof input.secret === 'string' ? input.secret : '',
    );
  });

  handle(CHANNELS.podcastClearDirectoryCredentials, () =>
    context.podcast.clearDirectoryCredentials(),
  );

  handle(CHANNELS.podcastImportOpml, async () => {
    const window = context.getWindow();
    if (!window) return emptyPodcastImport();
    const result = await dialog.showOpenDialog(window, {
      title: 'Import podcast subscriptions',
      buttonLabel: 'Import OPML',
      properties: ['openFile'],
      filters: [
        { name: 'OPML', extensions: ['opml', 'xml'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return emptyPodcastImport();
    const xml = await readFile(result.filePaths[0], 'utf8');
    return context.podcast.importOpmlText(xml);
  });

  handle(CHANNELS.podcastExportOpml, async (): Promise<Result<{ path: string | null; bytes: number }>> => {
    const window = context.getWindow();
    if (!window) return ok({ path: null, bytes: 0 });
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(window, {
      title: 'Export podcast subscriptions',
      defaultPath: join(context.dataDirectory, `statocyst-podcasts-${stamp}.opml`),
      filters: [{ name: 'OPML', extensions: ['opml'] }],
    });
    if (result.canceled || !result.filePath) return ok({ path: null, bytes: 0 });
    const xml = await context.podcast.exportOpmlText();
    await writeFile(result.filePath, xml, 'utf8');
    return ok({ path: result.filePath, bytes: Buffer.byteLength(xml) });
  });

  handle(CHANNELS.downloadAdd, async (trackId: unknown) => {
    if (typeof trackId !== 'string' || trackId.length === 0) {
      return fail('INVALID_ARGUMENT', 'trackId must be a non-empty string');
    }
    const window = context.getWindow();
    return context.downloads.download(trackId, (progress) => {
      if (window && !window.isDestroyed()) {
        window.webContents.send(CHANNELS.downloadProgress, progress);
      }
    });
  });

  handle(
    CHANNELS.downloadRemove,
    async (trackId: unknown): Promise<Result<{ removed: boolean }>> => {
      if (typeof trackId !== 'string' || trackId.length === 0) {
        return fail('INVALID_ARGUMENT', 'trackId must be a non-empty string');
      }
      return context.downloads.remove(trackId);
    },
  );

  handle(CHANNELS.downloadList, () => context.downloads.list());

  handle(CHANNELS.downloadStats, () => context.downloads.stats());

  handle(CHANNELS.cacheStats, () => context.cache.stats());

  handle(
    CHANNELS.cacheClear,
    async (): Promise<Result<{ removed: number }>> => {
      const removed = await context.cache.clear();
      return ok({ removed });
    },
  );

  handle(
    CHANNELS.cacheReconcile,
    async (): Promise<Result<{ removedEntries: number; removedOrphans: number }>> => {
      const result = await context.cache.reconcile();
      return ok(result);
    },
  );

  ipcMain.on(CHANNELS.engineEvent, (event, payload: unknown) => {
    const window = context.getWindow();
    if (!window || window.isDestroyed() || event.sender.id !== window.webContents.id) return;
    context.playback.engineEvent(payload);
  });

  context.logger.info('ipc.registered');
}
