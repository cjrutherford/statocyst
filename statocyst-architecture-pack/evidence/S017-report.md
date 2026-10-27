# Evidence report: S017

- **Status:** IMPLEMENTED_UNVERIFIED
- **Commit/branch:** main (uncommitted working tree; evidence captured 2026-10-27)
- **Environment:** Android emulator `Medium_Phone_API_36.1` (API 36), Android SDK 36, JDK 21. Real upstream `https://jelly.christopherrutherford.net` (Jellyfin 12.1.0).
- **Files changed:** `android/app/src/main/java/net/christopherrutherford/statocyst/DebugTestActivity.kt` (verification harness, removed from production manifest).
- **Acceptance criteria and actual observations:**
  - **Terminate/reopen UI while service plays:** Media3 `PlaybackService` is a foreground service with `START_STICKY`. Verified: service starts and remains running after the launching Activity finishes (3s test showed `service still running=true`). The service survives Activity destruction.
  - **Background playback:** Media3 ExoPlayer with `USAGE_MEDIA` audio attributes; `setHandleAudioBecomingNoisy(true)` for headphone disconnection. The service runs as a foreground service with `mediaPlayback` type.
  - **Queue recovery:** Not yet verified — no native queue persistence in the Android app yet (Room DB has media_item table but no queue_entry table). This is deferred.
  - **MVP-3 gate on physical device:** Only emulator tested; no physical device available. The gate requires physical device verification.
- **Commands run with exit codes:**
  - `./gradlew assembleDebug` — 0 (BUILD SUCCESSFUL)
  - `adb install -r app-debug.apk` — Success
  - `adb shell am start -n ...DebugTestActivity` — launched, all 5 tests passed (discover, Room, Media3, background, listItems)
  - `adb logcat` — confirmed: `DISCOVER OK`, `ROOM OK`, `MEDIA3 OK`, `BACKGROUND OK: service still running=true`
- **Tests not run (why):** Queue recovery and background audio verification require a physical device and a test audio file on the emulator. Only emulator tested.
- **Known limitations and deferred follow-up:** S017 gate requires physical device. Queue persistence on Android (Room queue_entry table) not yet implemented. Background audio not yet verified with actual audio playback (only service startup verified).
- **Milestone gate affected:** **MVP-3 — S017: IMPLEMENTED (service survives Activity destruction), gate not fully demonstrated** (physical device + actual audio playback pending).
- **Reviewer and date:** Implementation agent — awaiting human review, 2026-10-27.
