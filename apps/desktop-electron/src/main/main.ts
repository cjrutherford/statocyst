import './schemes';
import { app, BrowserWindow, Menu, session, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { StatocystDatabase } from '@statocyst/persistence';
import { registerIpc, type IpcContext } from './ipc';
import { JellyfinService } from './jellyfin-service';
import { SafeStorageTokenCodec } from './credential-store';
import { LibraryService } from './library-service';
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
const logPath = join(dataDirectory, 'logs', 'statocyst.log');
const demoDirectory = process.env['STATOCYST_DEMO_DIR'] ?? join(app.getAppPath(), 'resources/demo');
const rendererUrl = process.env['STATOCYST_RENDERER_URL'];

let mainWindow: BrowserWindow | null = null;
let database: StatocystDatabase | null = null;
let playback: PlaybackService | null = null;
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
  });
  await playback.init();

  // Artwork is created on demand during import.
  await mkdir(artworkDirectory, { recursive: true });

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
    logger,
    version: app.getVersion(),
    packaged: app.isPackaged,
  };

  registerProtocols({
    lookupTrack: async (trackId) => {
      const track = await db.getTrack(trackId).catch(() => null);
      if (!track) return null;
      const base = { id: track.id, path: track.path, artworkPath: track.artworkPath };
      if (track.sourceKind !== 'jellyfin') return base;
      const remote = await jellyfin.resolveRemoteTrack(track.sourceId);
      if (!remote) return base;
      return { ...base, remote: { serverUrl: remote.serverUrl, itemId: track.path, token: remote.token } };
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
