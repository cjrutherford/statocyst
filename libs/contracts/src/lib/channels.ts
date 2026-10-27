export const CHANNELS = {
  appInfo: 'app:info',
  appDiagnostics: 'app:diagnostics',
  appOpenDataFolder: 'app:open-data-folder',
  appQuit: 'app:quit',

  libraryPickFiles: 'library:pick-files',
  libraryPickFolder: 'library:pick-folder',
  libraryImportPaths: 'library:import-paths',
  libraryImportDemo: 'library:import-demo',
  libraryList: 'library:list',
  libraryStats: 'library:stats',
  libraryRemove: 'library:remove',
  libraryChanged: 'library:changed',

  playbackGetSnapshot: 'playback:get-snapshot',
  playbackGetQueue: 'playback:get-queue',
  playbackCommand: 'playback:command',
  playbackEvent: 'playback:event',

  engineLoad: 'engine:load',
  engineCommand: 'engine:command',
  engineEvent: 'engine:event',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
} as const;

export const IPC_COMMAND_LIMIT = 64;
export const IPC_IMPORT_PATH_LIMIT = 10_000;
