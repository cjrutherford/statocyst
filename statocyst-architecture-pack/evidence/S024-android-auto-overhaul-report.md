# S024 — Resume position, home-screen widget, Play Store doc (1.5.0, versionCode 23)

Request: document what Google Play publishing needs; add a widget (now playing + top favorites); persist the last play state so resuming continues from where the user left off.

## Resume position
- Native persistence already existed (`QueueStore`, 5 s ticker, `restoreQueue`). Root cause of "starts from the beginning": `playback.store.ts` `toggle()` resumed with a `playEntry` command for the current entry, and the native `playEntry` always does `seekTo(idx, 0)`. Fix: `toggle()` now sends `play` (no track), which continues the current item in place.
- New instrumented test `ResumePositionTest`: saves a queue at 42 s, restarts the service, asserts it restores paused at ~42 s, then `play()` continues from >= 42 s.

## Widget (`widget/`, 4x3, resizable)
- `NowPlayingWidget` (AppWidgetProvider, RemoteViews): artwork, title/artist, prev / play-pause / next, and the top 4 favorites (same order as the Favorites folder in the app and Android Auto). Transport buttons go through Media3's `MediaButtonReceiver`, so they also revive the service and saved queue. Tapping a favorite plays it with the favorites queued around it (`WidgetActionReceiver`, controller + `track::<id>@@favorites`). Tapping the header opens the app.
- `PlaybackService` mirrors the current item/play state into `WidgetStateStore` (SharedPreferences, so the widget keeps the last song after the process dies) and refreshes on transitions, play/pause, metadata, favorites changes and web favorites sync.
- Artwork is decoded on a worker thread from the token-free `ArtworkProvider` content URI.
- "Top favorites" = first favorites in list order; there is no play-count data.

## Play Store doc
- `android/PLAY_STORE.md` (linked from `RELEASING.md`): requirements (account/12-tester rule, AAB + Play App Signing, target API 36, listing assets, Data safety, FGS declarations, Android Auto), repo gap table, Data safety draft, checklist. Policy facts were looked up 2026-10-29; several came from third-party summaries, so re-check in Play Console.

## Verification
- Android unit tests pass; full instrumented suite on the emulator (API 36): 25 tests, 0 failures, including the new `ResumePositionTest` and `NowPlayingWidgetTest` (renders current song + only the top 4 favorites, empty/idle states, and a favorite broadcast plays that track through the real service and publishes widget state).
- Widget layouts rendered to PNG on the emulator and inspected (playing, and idle/no favorites).
- `dumpsys appwidget` shows the provider registered on the installed release build.
- Release APK 1.5.0 / v23 published, SHA-256 8b2924e6d94da4aa6f1d5fca6c57d005448c9b5afd00aefa904d6760adc07b78 (local == public), installed on the emulator.

## Not verified
- The widget was not placed on a real launcher, so tapping the transport buttons from the home screen (Media3 receiver starting the service from a widget PendingIntent) is untested; the favorite-tap path is covered by the broadcast test, not a real tap.
- The `toggle()` web fix has no automated test (no spec exists for the store); it was found by reading the code path, and the native half is covered by `ResumePositionTest`.
- The widget artwork path (content URI decode) was not exercised with real artwork; only the placeholder was rendered.
- AAB build and Play upload steps are documented but not implemented or run.
