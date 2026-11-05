# Evidence report: S031 — Quality-aware pins

**Status:** IMPLEMENTED_UNVERIFIED / resume gate BLOCKED
**Date:** 2026-11-05
**Branch:** feature/rural-offline-parity

## What changed
- Contracts: `DownloadProfile = original | balanced | saver`, `Settings.downloadQuality`,
  download metadata (`profile`, `codec`, `bitRate`, `sourceBytes`).
- Android:
  - `DownloadProfile` maps Balanced to 128 kbps MP3 and Saver to 96 kbps MP3. MP3 is the
    common denominator already proven on Android and iOS; it avoids codec/container drift.
  - Room v5→v6 adds the four download columns with truthful defaults (`original`, 0).
  - `DownloadManager` writes transcoded bytes as `.mp3` (not the source extension), replaces
    an existing pin when the quality changes, and stores the source size for savings reporting.
  - `DownloadCenter` keeps the profile per queued track and persists it with the pending list.
    `DownloadPolicy` estimates a transcode from its target bitrate, not the master size.
  - The context menu offers Original / Balanced / Saver; the Storage tab sets the default.
- Renderer: Offline badges show `Pinned · saver`; the settings explain the trade-off.

## Commands and results
| Command | Result |
| --- | --- |
| `nx run-many -t typecheck test -p contracts jellyfin-client desktop desktop-electron --skip-nx-cache` | PASS |
| `nx build desktop --skip-nx-cache` | PASS |
| `./gradlew testDebugUnitTest` (JDK 21) | PASS — includes 10 `DownloadPolicyTest` cases |
| `Range` probe against the production Jellyfin server | BLOCKED: no credentials/endpoint in this environment |
| Transcode pin on a device | NOT RUN |
| `./gradlew assembleDebug` (JDK 21) | PASS |

## The gate (ADR-035)
The transcode endpoint is a progressive MP3 stream. `ResumableDownload` treats a 200 reply
to a ranged request as "restart", so a dropped saver transfer restarts from zero rather than
corrupting the file. That is safe but not yet the rural behaviour we want. Before `VERIFIED`:
1. `curl -H "Range: bytes=100-" .../Audio/<id>/stream.mp3?audioCodec=mp3&audioBitRate=96000`
   and record status / `Accept-Ranges` / `Content-Range`.
2. If 206 works: add the probe result to ADR-035 and test a kill/resume.
3. If 200: choose server-side pre-transcode (preferred) or keep restart with an explicit
   "will restart" warning; do not claim resumable saver pins.

## Gaps
- iOS still downloads the original; the shared setting is visible there but not honoured until
  the iOS download manager takes a profile (S034 follow-up).
- Replacing a pin at a different quality deletes the old copy first; there is no "upgrade to
  original on Wi-Fi" flow yet (S036).
- The transcode is MP3 for both platforms; Opus/AAC can be added once the Range behaviour is
  proven, but changing the codec changes the file extension and needs its own test.
