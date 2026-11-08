# Evidence report: S049 — Android podcast playback and downloads

**Status:** IMPLEMENTED_UNVERIFIED (build + unit tests; screen-off/process-death/offline device gates pending S053)
**Date:** 2026-11-08
**Depends on:** S046, S047, S048

## Landed

### Native source and metadata

- `SourceResolver.prepare` now treats `sourceKind='podcast'` as a direct remote URI when the
  enclosure is HTTP(S), after the verified-download/cache checks. A local podcast file still
  resolves through the loopback media server.
- `StatocystPlugin.playbackUrl` returns the enclosure URL for podcasts and marks it remote,
  so the MediaController/QueueStore path can load it without Jellyfin auth.
- `PlaybackService.resolveItem` uses the cached podcast artwork path through
  `LocalMediaServer` instead of the external-art lookup.
- `stateJson` exposes Media3 playback speed; `setRate` sets `ExoPlayer.setPlaybackSpeed`
  within 0.5–3×.

### Shared renderer bridge

- `CapacitorBridge` now keeps music and podcast queue models separately, persists both plus
  the active context in Capacitor Preferences, and pushes only the active queue to the native
  player.
- `command`, `getSnapshot` and `getQueue` accept a playback context. Inactive queue edits
  stay in JS and do not switch native audio; a play/seek on the other context swaps the
  native queue and restores its saved position.
- Native state/queue adoption only updates the active context.
- `PodcastPlaybackStore.playEpisode` seeks to the episode resume position after the native
  load, so per-episode resume works without adding a native queue-item position field.
- `createCapacitorPodcastBridge` remembers episode rows in the renderer track map so native
  play commands can resolve the media item.
- Podcast downloads already use the shared download queue introduced in S048/S047; the
  native download manager resolves `media_item.path` for podcast pins through the same
  source checks.

## Commands and results

| Command | Result |
| --- | --- |
| `./gradlew :app:compileDebugKotlin` (JDK 21, SDK 36) | BUILD SUCCESSFUL |
| `./gradlew :app:testDebugUnitTest` | BUILD SUCCESSFUL |
| `pnpm exec tsc-rs --noEmit -p apps/desktop/tsconfig.json` | exit 0 |

Logs:

- `/tmp/statocyst-s049-android.log`
- `/tmp/statocyst-s049-desktop-tsc.log`

## Not verified / next

- No screen-off, process-death, lock-screen or airplane-mode podcast run was captured on a
  physical device; S053 must run those and record the result.
- The native Media3 queue is single-queue: the JS bridge preserves both contexts and pushes
  the active one, but a process restart while a context is inactive relies on the JS
  Preferences copy; S053 should test both restart orders.
- Podcast download integration uses the existing native DownloadManager, but no podcast
  download was exercised on the Android emulator.
- Android Auto podcast browse is S052.
