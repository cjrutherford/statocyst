# Evidence report: S034 — iOS offline parity

**Status:** IMPLEMENTED_UNVERIFIED (device/Xcode gate)
**Date:** 2026-11-05
**Branch:** feature/rural-offline-parity

## What changed
- `DownloadAndCache.swift`:
  - Pinned downloads now use one background `URLSession` with the stable identifier
    `com.hopefulaspirationsindustries.statocyst.downloads`.
  - Durable pending queue (`statocyst.downloads.pending.v1`) and resume map
    (`statocyst.downloads.resume.v1`) in UserDefaults. `restorePending()` rebuilds work
    after launch and on `didBecomeActive`; tasks that outlive the process are adopted by
    `taskDescription`.
  - 401/403 fatal; 429/5xx/transport errors retry with `[2,5,15,30]` backoff; 416 clears
    resume and restarts with a visible message; progress is reported from `didWriteData`.
  - Cancel keeps resume data; `DownloadManager.remove()` discards it. Removing a track or
    server also cancels its queue row and clears stale resume blobs on token change.
- `PlaybackManager.swift`: `NWPathMonitor`, network-failure recovery that keeps the slot
  and position, capped backoff with a 15 s watchdog, interface-change re-resolution,
  auto-quality transcode fallback, and `waiting-network` state reporting.
- `StatocystPlugin.swift`: restores the queue on load and foreground, and cancels queue
  rows when the underlying track/server is removed.
- `AppDelegate.swift`: added
  `application(_:handleEventsForBackgroundURLSession:completionHandler:)`; the session
  calls the stored handler from `urlSessionDidFinishEvents(forBackgroundURLSession:)`.
  (This was the one gap the background-session design called out.)

## Verification
| Check | Result |
| --- | --- |
| Swift syntax parse (tree-sitter) on all 16 iOS Swift files | PASS |
| `xcodebuild` | BLOCKED: no macOS/Xcode in this environment; CI must build |
| Suspend 2+ minutes / kill + relaunch / 10-minute outage | NOT RUN |

## Gaps
- iOS still downloads the **original**; the S031 quality profile is Android-only in this PR.
  The settings UI hides the quality selector on iOS/desktop rather than offering a dead control.
- A direct `downloadTrack` call is not added to the durable queue, so it is not restored by
  `restorePending()`; its background task may still finish as an orphan.
- Force-quit may lose the opaque resume blob; the UI reports a restart rather than pretending
  it resumed.
- No iOS test target exists; the gate is an Xcode build plus device evidence.
