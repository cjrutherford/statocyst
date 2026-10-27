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
  libraryImportProgress: 'library:import-progress',
  libraryImportCancel: 'library:import-cancel',

  playbackGetSnapshot: 'playback:get-snapshot',
  playbackGetQueue: 'playback:get-queue',
  playbackCommand: 'playback:command',
  playbackEvent: 'playback:event',

  engineLoad: 'engine:load',
  engineCommand: 'engine:command',
  engineEvent: 'engine:event',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  jellyfinListServers: 'jellyfin:list-servers',
  jellyfinAddServer: 'jellyfin:add-server',
  jellyfinLogin: 'jellyfin:login',
  jellyfinLogout: 'jellyfin:logout',
  jellyfinRemoveServer: 'jellyfin:remove-server',
  jellyfinSync: 'jellyfin:sync',
  jellyfinQuickConnectInitiate: 'jellyfin:quick-connect-initiate',
  jellyfinQuickConnectPoll: 'jellyfin:quick-connect-poll',
  jellyfinQuickConnectLogin: 'jellyfin:quick-connect-login',
  jellyfinEncryptionAvailable: 'jellyfin:encryption-available',
} as const;

export const IPC_COMMAND_LIMIT = 64;
export const IPC_IMPORT_PATH_LIMIT = 10_000;
