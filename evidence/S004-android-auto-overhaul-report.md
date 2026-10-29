# Slice 4 — Auto browse tree (versionCode 5, 0.2.4-s4)

Changes
- Browse tree: Recently played, Favorites, Playlists, Albums, Artists, All tracks, Now playing queue.
  Empty Recents/Favorites/Playlists/Queue are hidden from the root. Pagination (page/pageSize) on every folder.
  Content-style hints: root defaults + per-folder (Albums grid, others list).
- Queue folder mirrors the live ExoPlayer queue (`queue::<entryId>`); picking a row jumps within the queue.
- Tracks listed in a folder carry the folder in their media id (`track::<id>@@<folder>`), because Auto only
  sends the media id back; playing one queues the folder (windowed 50 before / 250 after) so next/previous work.
- Room v4 (migration 3->4): favorite, playlist, playlist_track, recent. Web layer pushes favorites/playlists
  via `syncUserState` (debounced); native records recents on each track transition.
- Invalidation: library sync/import/remove -> `onCatalogChanged`; favorites/playlists -> `onUserStateChanged`;
  queue/recents -> `notifyChildrenChanged` so subscribed browsers refetch.
- Tracks/browse no longer touch the DB on the session thread beyond the async `future()` helper.

Verified (Android 16 emulator, MediaBrowser = same binder path as Auto)
- Instrumented `MediaLibraryServiceBrowseTest`: 4/4 pass — root + hints, paging (250 fixture tracks, no overlap,
  last page size, empty beyond end), favorites/playlists appear and subscribers get onChildrenChanged,
  playing a playlist track queues the 3-track playlist at the right index and the Queue folder jump keeps the queue.
- Unit tests: 70/70 vitest; Gradle BrowseTreeTest rewritten (paging, windowing, contexts, queue, hints) passes.
- Migration 3->4 exercised: installed published v4 APK, upgraded to v5 over it, DB user_version=4 with all new tables, no crash.

Not verified
- DHU / real head unit (none available). Search/voice, custom buttons, onPlaybackResumption are slice 5.
- Recents population on a live playback run, and favorites/playlists mirroring from the real WebView UI,
  were not exercised end-to-end on the emulator because its library was emptied (see below).

Incident
- The first `connectedDebugAndroidTest` run failed with INSTALL_FAILED_INSUFFICIENT_STORAGE (emulator /data 94% full);
  Gradle's installer had already removed the app, which deleted the emulator copy's Room library and Jellyfin
  session. Emulator only; no user device affected. The pre-existing androidTest also called clearAllTables(),
  so it was rewritten to be non-destructive (fixture tracks + snapshot/restore). Stale Capacitor template
  ExampleInstrumentedTest (asserts package com.getcapacitor.myapp) removed.
