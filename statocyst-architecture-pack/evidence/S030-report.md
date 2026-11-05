# Evidence report: S030 — Size truth

**Status:** IMPLEMENTED_UNVERIFIED
**Date:** 2026-11-05
**Branch:** feature/rural-offline-parity (from main @ b56a2a0)

## What changed
- `Track` now carries `sizeBytes` and `bitrate` (`libs/contracts/src/lib/playback.ts`).
- Jellyfin mapping reads `MediaSources[0].Size`:
  - Electron: `libs/jellyfin-client/src/lib/jellyfin-client.ts`, `apps/desktop-electron/src/main/jellyfin-service.ts`.
  - Android: `StatocystPlugin.jellyfinEntity` + `trackJson`.
  - iOS: `StatocystPlugin.jellyfinEntity` + `trackDict`.
- Renderer surfaces: library row, album/artist meta, selection total, Offline per-row and total.
- Desktop Electron `toTrack` no longer strips size/bitrate.

## Commands and results
| Command | Result |
| --- | --- |
| `nx run-many -t typecheck -p contracts jellyfin-client desktop desktop-electron --skip-nx-cache` | PASS (4 tasks) |
| `nx run-many -t test -p contracts jellyfin-client desktop-electron --skip-nx-cache` | PASS (68 tests, 2 skipped) |
| `nx build desktop --skip-nx-cache` | PASS |
| `cap sync android` | PASS |
| `./gradlew testDebugUnitTest` (JDK 21, downloaded locally) | PASS (all app unit tests) |
| `./gradlew assembleDebug` (JDK 21) | PASS |
| `xcodebuild` | BLOCKED: macOS/Xcode not available in this environment |

## Unresolved risks
- The Android project compiles and its unit tests pass with Temurin 21; iOS still needs CI/macOS.
- A Jellyfin server may omit `MediaSources[0].Size`; the UI must show an unknown size rather than
  `0 B` in that case. The current change stores `0` and the renderer hides it, which is acceptable
  for S030 but S031/S032 must treat `0` as unknown, not as an empty file.
- The reference library used in the review had 2,145 tracks; no real device run was performed here.

## Next
S031 is gated on the ADR-035 Range probe. S032 and S033 can proceed in parallel with S034/S039.
