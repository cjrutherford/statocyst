# Evidence report: S033 — Playback that never gives up

**Status:** IMPLEMENTED_UNVERIFIED
**Date:** 2026-11-05
**Branch:** feature/rural-offline-parity

## What changed
- Contract: `waiting-network` is a first-class `PlaybackState` (schema + architecture pack updated).
- Android `PlaybackService`:
  - Removed the eight-attempt / ~157 s limit. Recovery now loops for as long as the item is
    current, sleeping up to 30 s with jitter and waking immediately on the network callback.
  - `networkHold` is published; `StatocystPlugin.stateName` reports `waiting-network`.
  - A deliberate pause or a track change cancels the hold; a READY player clears it.
  - No `player.pause()` on exhaustion (there is no exhaustion), so a returning network plays.
- Renderer: status label, player bar chip ("Offline — will resume"), Now Playing state label,
  `isPlaying`/toggle treat `waiting-network` as an active hold so the pause button cancels it.
- iOS playback recovery is delegated to S034 and must use the same state name.

## Commands and results
| Command | Result |
| --- | --- |
| `nx run-many -t typecheck test -p contracts desktop --skip-nx-cache` | PASS |
| `nx build desktop --skip-nx-cache` | PASS |
| `./gradlew testDebugUnitTest` (JDK 21) | PASS (all app unit tests) |
| `./gradlew assembleDebug` (JDK 21) | PASS |
| 10-minute shaped outage | NOT RUN |

## Risks / open items
- The recovery loop is intentionally unbounded. A deleted track that still reports a network
  error would retry forever; `PlaybackFailures.isNetworkLoss` should keep 404/401 out of this path.
  Add a "stop after N consecutive resolve failures" guard if field reports show it.
- `networkHold` is process-static and is not persisted; a process death mid-hold restores the
  saved queue/position through the existing path.
- iOS must set `waiting-network` and auto-resume; otherwise the renderer label is Android-only.
