# Evidence report: S019

- **Status:** IMPLEMENTED_UNVERIFIED
- **Commit/branch:** main (uncommitted working tree; evidence captured 2026-10-27)
- **Environment:** Ubuntu 26.04 LTS, Android SDK 36, JDK 21 (Android Studio JBR), Media3 1.4.1. Automotive test environment not available in this workspace.
- **Files changed:**
  - `android/app/src/main/AndroidManifest.xml` — exported `PlaybackService` as `MediaLibraryService`, added `android.media.browse.MediaBrowserService` intent-filter, added `com.google.android.gms.car.application` meta-data pointing to `@xml/automotive_app_desc`.
  - `android/app/src/main/res/xml/automotive_app_desc.xml` (new) — declares `uses name="media"`.
  - `android/app/src/main/java/net/christopherrutherford/statocyst/media/PlaybackService.kt` — marks browsable/playable nodes via `MediaMetadata` (`setIsBrowsable`/`setIsPlayable`), sets `RequestMetadata.mediaUri` for playable tracks, session activity pending intent made immutable/update-current with fallback launch intent.
- **Acceptance criteria and actual observations:**
  - **Expose supported media categories:** Root + Albums/Artists/Tracks/Queue exposed by `MediaLibraryService` (S018). Categories are marked browsable; tracks/albums/artists are browsable where applicable.
  - **Session actions and proper capabilities:** MediaLibrarySession with session activity, foreground `mediaPlayback` service, exported for external browsers (Android Auto). Playback controls remain in native ExoPlayer path.
  - **Automotive test environment can browse and initiate playback:** NOT demonstrated. No Android Auto/Car emulator or physical car head unit available; gate requires automotive test environment.
- **Commands run with exit codes:**
  - `./gradlew :app:compileDebugKotlin` — 0 (BUILD SUCCESSFUL)
  - `./gradlew assembleDebug` — previously successful in earlier build
- **Tests not run (why):** Automotive browse/playback requires an Android Auto enabled environment (DHU/emulator with Android Auto or physical head unit). Not available here.
- **Artifacts:** None from device run.
- **Safety/security considerations:** No credentials/tokens exposed to browser metadata; only catalog metadata. Exported service restricted to MediaLibraryService/MediaBrowserService actions; session activity points to app launch.
- **Known limitations and deferred follow-up:** Initiating playback from Auto is not wired to actual Jellyfin stream resolution (source resolution S020). Queue is empty (S021). Artwork not set for Auto (S022). Physical/automotive validation required for `VERIFIED`.
- **Milestone gate affected:** **MVP-4 — S019: categories/actions/capabilities exposed for Auto; automotive browse+play not demonstrated** (environment unavailable).
- **Reviewer and date:** Implementation agent — awaiting human review, 2026-10-27.

## Update 2026-10-28 (Android Auto overhaul, slices 2-10)

- **Status remains IMPLEMENTED_UNVERIFIED.** The gate ("automotive test environment can browse and initiate playback") is **not** demonstrated: no Desktop Head Unit (`$ANDROID_HOME/extras/google/auto` is absent) and no Android Auto emulator in this workspace.
- **Environment:** Media3 1.8.0, compile/target SDK 36, emulator Android 16 (Medium_Phone_API_36.1). Final build versionCode 11 / 0.3.0, SHA256 `f99044fa8d80763702b2b151c10c79d899afb97749ddef59f24b937f08cee02b`.
- **Automated evidence (all passing at the final build):** Kotlin unit tests 38/38; `MediaLibraryServiceBrowseTest` instrumented 7/7 (root folders, paging, queue, favorites, playlists, search, radio/voice) against the real `MediaLibraryService` via a `MediaBrowser`; web `nx run-many -t test` 6/6.
- **User-reported (not an automated gate):** with the slice-4 build, playback was live on the car screen. The app icon in the launcher list was **not** confirmed; guidance for "Unknown sources" and "Customize launcher" was added to Settings (slice 10).
- **Still required for VERIFIED:** run the DHU (or a real head unit), confirm (1) app icon in the launcher, (2) browse Recents/Favorites/Playlists/Radio/Albums/Artists/Tracks, (3) start playback from the browse tree, (4) custom shuffle/repeat/favorite buttons, (5) voice search. Check logcat for `browse denied for <pkg>` if the head unit package is not in the `ControllerPolicy` allowlist.
- Per-slice evidence: `evidence/S002..S010-android-auto-overhaul-report.md`.
