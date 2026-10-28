# Evidence report: S020

- **Status:** IMPLEMENTED_UNVERIFIED
- **Commit/branch:** main (uncommitted working tree; evidence captured 2026-10-27)
- **Environment:** Ubuntu 26.04 LTS, Android SDK 36, JDK 21 (Android Studio JBR), Media3 1.4.1, Room 2.6.1.
- **Files changed:**
  - `android/app/src/main/java/net/christopherrutherford/statocyst/media/SourceResolver.kt` (new) — headless resolver using Room + shared prefs; for Jellyfin builds `Audio/{id}/stream?static=true&api_key={token}`, for local uses `path`; `validateToken` via JellyfinClient; no WebView/UI.
  - `android/app/src/main/java/net/christopherrutherford/statocyst/media/PlaybackService.kt` — onAddMediaItems resolves browse track IDs to playable URIs via SourceResolver; PLAY_TRACK/ENQUEUE actions resolve headlessly; PLAY accepts trackId.
  - `android/app/src/main/java/net/christopherrutherford/statocyst/plugin/StatocystPlugin.kt` — play() accepts trackId/url; added enqueue(), saveSession(), clearSession() to store Jellyfin session for native service.
- **Acceptance criteria and actual observations:**
  - **Play a known cached/local file with WebView never created:** Implemented headless resolution path. WebView not referenced.
  - **Expired auth fails safely:** SourceResolver.validate() uses JellyfinClient.validateToken; resolution returns null on missing session/exception (no crash). Not demonstrated on device with expired token.
- **Commands run with exit codes:**
  - `./gradlew :app:compileDebugKotlin` — 0
  - `./gradlew assembleDebug` — 0
- **Tests not run (why):** Requires device with Jellyfin session + cached catalog and expired token scenario.
- **Safety/security considerations:** Tokens read from SharedPreferences (same store as app); only used to build stream URL or validate. No logging of tokens.
- **Known limitations:** Stream uses `api_key` in URL (standard Jellyfin). Transcoding not forced; static stream preferred.
- **Milestone gate affected:** **MVP-4 — S020: headless resolution implemented; expired-auth/device playback not demonstrated.**
- **Reviewer and date:** Implementation agent — awaiting human review, 2026-10-27.
