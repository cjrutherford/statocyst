# Evidence report: S021

- **Status:** IMPLEMENTED_UNVERIFIED
- **Commit/branch:** main (uncommitted working tree; evidence captured 2026-10-27)
- **Environment:** Ubuntu 26.04 LTS, Android SDK 36, JDK 21 (Android Studio JBR), Media3 1.4.1.
- **Files changed:**
  - `android/app/src/main/java/net/christopherrutherford/statocyst/media/QueueStore.kt` (new) — SharedPreferences-backed queue persistence (track IDs + current index).
  - `android/app/src/main/java/net/christopherrutherford/statocyst/media/PlaybackService.kt` — persists queue on transitions/seek/discontinuity and on stop/destroy; restores queue on onCreate headlessly via SourceResolver; ENQUEUE action adds resolved items.
- **Acceptance criteria and actual observations:**
  - **Kill/restart tests maintain valid queue order:** Implemented save/restore. Not demonstrated.
  - **No duplicate active player:** Single ExoPlayer in MediaLibraryService; queue restore sets media items on existing player.
- **Commands run with exit codes:**
  - `./gradlew :app:compileDebugKotlin` — 0
  - `./gradlew assembleDebug` — 0
- **Tests not run (why):** Requires kill/restart of service/app on device.
- **Safety/security considerations:** Only track IDs persisted.
- **Known limitations:** Queue persisted as IDs; resolved on restore (requires session/catalog). If resolution fails for items, they may be skipped.
- **Milestone gate affected:** **MVP-4 — S021: queue persistence implemented; kill/restart not demonstrated.**
- **Reviewer and date:** Implementation agent — awaiting human review, 2026-10-27.
