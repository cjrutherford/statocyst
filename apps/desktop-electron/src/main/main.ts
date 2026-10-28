import './schemes';
import { app, BrowserWindow, Menu, session, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { StatocystDatabase } from '@statocyst/persistence';
import { decideQuality } from '@statocyst/playback-core';
import { registerIpc, type IpcContext } from './ipc';
import { JellyfinService } from './jellyfin-service';
import { SafeStorageTokenCodec } from './credential-store';
import { LibraryService } from './library-service';
import { DownloadService } from './download-service';
import { CacheManager } from './cache-manager';
import { Logger } from './logger';
import { PlaybackService } from './playback-service';
import { registerProtocols } from './protocol';
import { SettingsService } from './settings-service';

const APP_NAME = 'Statocyst';
app.setName(APP_NAME);

// On Linux without a keyring, opt into Electron's basic (hardcoded-key) store so
// the connector remains testable. Real deployments use the OS keychain.
if (process.env['STATOCYST_PASSWORD_STORE'] === 'basic') {
  app.commandLine.appendSwitch('password-store', 'basic');
}

const dataDirectory = process.env['STATOCYST_DATA_DIR'] ?? app.getPath('userData');
if (process.env['STATOCYST_DATA_DIR']) {
  // Keep Chromium caches, logs and the database inside the explicit test run.
  app.setPath('userData', dataDirectory);
}

const databasePath = join(dataDirectory, 'statocyst.db');
const artworkDirectory = join(dataDirectory, 'artwork');
const downloadsDirectory = join(dataDirectory, 'downloads');
const cacheDirectory = join(dataDirectory, 'cache');
const logPath = join(dataDirectory, 'logs', 'statocyst.log');
const demoDirectory = process.env['STATOCYST_DEMO_DIR'] ?? join(app.getAppPath(), 'resources/demo');
const rendererUrl = process.env['STATOCYST_RENDERER_URL'];

let mainWindow: BrowserWindow | null = null;
let database: StatocystDatabase | null = null;
let playback: PlaybackService | null = null;
let downloads: DownloadService | null = null;
let cache: CacheManager | null = null;
let shuttingDown = false;
let servicesReady = false;

const logger = new Logger(logPath, 2 * 1024 * 1024, process.env['STATOCYST_LOG_CONSOLE'] === '1');

function getWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

async function getOrCreateDeviceId(db: StatocystDatabase): Promise<string> {
  const existing = await db.getAppState('device_id');
  if (existing) return existing;
  const id = randomUUID();
  await db.setAppState('device_id', id);
  return id;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 940,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    backgroundColor: '#050a18',
    autoHideMenuBar: true,
    icon: join(app.getAppPath(), 'resources/icons/statocyst-512.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
      devTools: !app.isPackaged || process.env['STATOCYST_DEVTOOLS'] === '1',
    },
  });

  window.once('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const allowed = rendererUrl ? url.startsWith(rendererUrl) : url.startsWith('file://');
    if (!allowed) {
      event.preventDefault();
      logger.warn('window.navigation.blocked', { url });
    }
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('window.render-process-gone', details);
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, '../desktop/browser/index.html'));
  }

  return window;
}

async function startServices(): Promise<IpcContext> {
  const db = await StatocystDatabase.open({ path: databasePath });
  database = db;

  await logger.init();
  logger.info('app.starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    dataDirectory,
    databasePath,
    packaged: app.isPackaged,
  });

  const settings = new SettingsService(db, logger);
  await settings.init();

  const deviceId = await getOrCreateDeviceId(db);
  const jellyfinIdentity = {
    client: 'Statocyst',
    device: 'Statocyst Desktop',
    deviceId,
    version: app.getVersion(),
  };

  const jellyfin = new JellyfinService({
    database: db,
    identity: jellyfinIdentity,
    codec: new SafeStorageTokenCodec(),
    logger,
  });

  const library = new LibraryService({
    database: db,
    artworkDirectory,
    logger,
    onChanged: (reason) => {
      void playback?.syncLibrary(reason);
    },
  });

  playback = new PlaybackService({
    database: db,
    settings,
    logger,
    getWindow,
    onTrackChanged: (_current, next) => {
      if (next) void cache!.prefetch(next);
    },
  });
  await playback.init();

  downloads = new DownloadService({
    database: db,
    downloadsDirectory,
    logger,
    identity: jellyfinIdentity,
    resolveRemoteTrack: (sourceId) => jellyfin.resolveRemoteTrack(sourceId),
  });

  cache = new CacheManager({
    database: db,
    cacheDirectory,
    logger,
    identity: jellyfinIdentity,
    getBudgetBytes: () => settings.get().cacheBudgetBytes,
    resolveRemoteTrack: (sourceId) => jellyfin.resolveRemoteTrack(sourceId),
  });

  // Artwork, downloads and cache are created on demand.
  await mkdir(artworkDirectory, { recursive: true });
  await mkdir(downloadsDirectory, { recursive: true });
  await mkdir(cacheDirectory, { recursive: true });

  const context: IpcContext = {
    getWindow,
    database: db,
    databasePath,
    logPath,
    dataDirectory,
    demoDirectory,
    library,
    playback,
    settings,
    jellyfin,
    downloads: downloads!,
    cache: cache!,
    logger,
    version: app.getVersion(),
    packaged: app.isPackaged,
  };

  const protocolMeter = registerProtocols({
    lookupTrack: async (trackId) => {
      const track = await db.getTrack(trackId).catch(() => null);
      if (!track) return null;
      const base = { id: track.id, path: track.path, artworkPath: track.artworkPath };
      // Prefer a verified local download for any source kind, so offline and
      // pinned content play without touching the network.
      const verified = await downloads!.getVerifiedDownload(trackId);
      if (verified) {
        return { id: track.id, path: verified.localPath, artworkPath: track.artworkPath };
      }
      // Then a cache hit (evictable, still local) before hitting the network.
      const cached = await cache!.getCached(trackId);
      if (cached) {
        return { id: track.id, path: cached, artworkPath: track.artworkPath };
      }
      if (track.sourceKind !== 'jellyfin') return base;
      const remote = await jellyfin.resolveRemoteTrack(track.sourceId);
      if (!remote) return base;
      // Quality policy (ADR-013): direct play unless the measured throughput,
      // buffer health and the user preference justify a transcode.
      const sourceBitsPerSecond = track.bitrate ? track.bitrate * 1000 : null;
      const decision = decideQuality({
        preference: settings.get().quality,
        directPlaySupported: true,
        transcodeAvailable: true,
        sourceBitsPerSecond,
        measuredBitsPerSecond: protocolMeter.throughputBitsPerSecond(),
        bufferSeconds: playback!.bufferHealth(),
        metered: false,
      });
      const transcoding = decision.mode === 'transcode';
      if (transcoding) {
        logger.info('playback.quality.transcode', {
          trackId,
          reason: decision.reason,
          bitrate: sourceBitsPerSecond,
        });
      }
      return {
        ...base,
        remote: {
          serverUrl: remote.serverUrl,
          itemId: track.path,
          token: remote.token,
          mode: transcoding ? ('transcode' as const) : ('direct' as const),
          maxBitrateKbps: transcoding ? 192 : undefined,
        },
      };
    },
    onMediaUnavailable: (trackId) => {
      logger.warn('media.unavailable', { trackId });
      void db.markMissing(trackId, true).catch(() => undefined);
    },
    remoteIdentity: jellyfinIdentity,
  });

  registerIpc(context);
  servicesReady = true;

  void library.refreshMissing().catch((error) => {
    logger.warn('library.missing.refresh-failed', { error });
  });

  return context;
}

async function shutdown(): Promise<void> {
  logger.info('app.shutting-down');
  try {
    await playback?.shutdown();
    await logger.flush();
    await database?.close();
  } catch (error) {
    logger.error('app.shutdown.failed', { error });
  }
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = getWindow();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler(() => false);

    try {
      await startServices();
      mainWindow = createWindow();
      logger.info('app.ready', {
        renderer: rendererUrl ?? 'file',
        demoDirectory,
      });
    } catch (error) {
      logger.error('app.startup.failed', { error });
      const message = error instanceof Error ? error.message : String(error);
      mainWindow?.webContents.send('app:fatal', message);
      await shutdown();
      app.exit(1);
    }
  });

  app.on('activate', () => {
    if (!getWindow()) {
      mainWindow = createWindow();
      if (servicesReady) {
        // A recreated window re-subscribes to the same authoritative services.
        mainWindow.webContents.once('did-finish-load', () => {
          void playback?.syncLibrary('window-recreated');
        });
      }
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (shuttingDown || !servicesReady) return;
    event.preventDefault();
    shuttingDown = true;
    void shutdown().finally(() => app.quit());
  });
}
