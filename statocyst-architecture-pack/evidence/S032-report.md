# Evidence report: S032 — Storage and metered policy

**Status:** IMPLEMENTED_UNVERIFIED
**Date:** 2026-11-05
**Branch:** feature/rural-offline-parity

## What changed
- `Settings` gains `downloadWifiOnly` (default true) and `downloadQuotaBytes` (0 = automatic).
- Renderer: Storage tab has "Download over" and "Offline limit"; the Capacitor bridge writes
  both to Preferences and pushes them to the native queue.
- Android:
  - `DownloadPolicy` (pure): 500 MB reserve, automatic 10 GB cap clamped to 25% of free space,
    bitrate/duration estimates, human-readable denial reasons.
  - `DownloadCenter`: live metered detection (`NET_CAPABILITY_NOT_METERED`) and Wi-Fi-only gate.
  - `DownloadQueue`: waits before touching the network and reports `waitingReason`
    ("Waiting for network" / "Waiting for Wi-Fi") to the app and notification.
  - `enqueueDownloads` preflights the database size estimate against pinned bytes, free space
    and quota; rejects with a specific reason. `setDownloadPolicy` updates a waiting queue.
  - `DownloadManager` refuses to start when free space is under the reserve.
- Contracts: `DownloadQueueEntry.waitingReason`.

## Commands and results
| Command | Result |
| --- | --- |
| `nx run-many -t typecheck test -p contracts jellyfin-client desktop desktop-electron --skip-nx-cache` | PASS |
| `nx build desktop --skip-nx-cache` | PASS |
| `./gradlew testDebugUnitTest` (JDK 21) | PASS — `DownloadPolicyTest` 10/10, `DownloadQueueTest` 9/9 |
| Android device (Wi-Fi/metered/airplane) | NOT RUN |

## Gaps / risks
- `DownloadPolicyTest` and `DownloadQueueTest` pass locally under Temurin 21.
- Concurrency on weak links is still 2 workers; the "one transfer at a time on weak links" part
  of S032 is deliberately deferred to S037 (WorkManager constraints).
- iOS native downloads ignore the policy until S034 lands; the renderer fields are shared, so
  the iOS UI will show them but the native queue does not gate yet. Track this in S034 evidence.
- Metered detection is best-effort; the manual "Any network" override is the escape hatch.

## Next
S033 (playback hold) is independent. S037 owns WorkManager/concurrency and the Downloads screen.
