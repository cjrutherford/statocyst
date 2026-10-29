# Slice 20 (gap closure): reliable background downloads and explicit progress

Version 19 / 1.3.0. Status: DONE. Not exercised against a real Jellyfin server or with the screen off on a device (see Not verified).

## Problems addressed (diagnosis in HANDOFF-S020-downloads.md)
Batches stopped because the loop lived in the WebView and the native copy ran in a plain plugin call with no foreground service; there was no retry or resume; downloads were sequential; failures were never counted. Progress was a single per-track signal shown only in Settings.

## What changed
Native:
- `downloads/ResumableDownload.kt`: retries I/O errors, 5xx and 429 with backoff (2/5/15/30 s), resumes from the `.part` file with `Range`, handles servers that ignore Range (restart) and 416 (already complete, or stale part restarted), waits while offline without spending attempts, counts attempts only when no progress was made, treats 401/403 (including HttpURLConnection's bare-401 IOException) as fatal, and verifies the received length against the expected total.
- `downloads/DownloadQueue.kt` (pure JVM): 2 workers, per-track state (queued, active, retrying, waiting, failed, done), aggregate progress, throttled events (4/s) with immediate state changes, cancel, retry failed, dismiss, and persistence of pending ids.
- `downloads/DownloadCenter.kt` and `DownloadService.kt`: process-wide queue; foreground service (`dataSync`) with an "n of m, x%" notification, Cancel action and a final summary; START_STICKY, and the queue restores pending tracks after a kill. Manifest adds `FOREGROUND_SERVICE_DATA_SYNC` and `ACCESS_NETWORK_STATE`.
- `DownloadManager` resumes a leftover `.part` (remote only, under 24 h old) and keeps it after a network failure. `downloadTrack` (single) benefits from retry and resume too.
- Plugin: `enqueueDownloads`, `cancelDownloads`, `retryFailedDownloads`, `dismissDownloads`, `getDownloadQueue`, and a `downloadQueue` event with the whole snapshot.

Web:
- Contracts: `DownloadQueueSnapshot`/`Entry`/`State` and optional `enqueue/cancelQueue/retryFailed/dismissQueue/queue/onQueue` on `DownloadsBridge` (desktop keeps the one-at-a-time path).
- `DownloadsStore` mirrors the native snapshot; the final toast now counts failures correctly (the old loop always reported zero); refreshes saved indicators as each track lands; picks up a running or finished queue after the UI restarts without re-announcing it.
- New `sc-download-status` in the shell, visible on every view: "Downloading 12 of 40", a bar driven by real bytes once every size is known (track count before that), "48 MB of 76 MB, 12 saved, 1 failed", the current track names, explicit pause states ("Waiting for network", "Connection problem, retrying (attempt 2)"), and Cancel / Retry failed / Dismiss with an expandable list of failed tracks and reasons. The duplicate library batch bar is hidden when the queue exists.

## Evidence
- Unit: 93/93 (20 new). `ResumableDownloadTest` (11, socket `FakeHttpServer` extended with headers and a declared length): resume after a dropped connection sends `Range: bytes=40-` and the file matches byte for byte; 503 retried with 2 s then 5 s backoff; gives up at the attempt limit; 401 with and without a challenge is fatal with one request; Range ignored restarts; 416 complete and 416 stale; offline waits without using attempts; attempts reset on progress (finishes with limit 2 over 10+ drops); cancel does not retry. `DownloadQueueTest` (9): completion and aggregates, failure kept with message then retry keeps the done count, state transitions, cancel, new batch replaces a finished one, no duplicate enqueue, dismiss, throttling, byte totals unknown until every size is known.
- Instrumented: 20/20 on emulator-5554 (2 new in `DownloadQueueServiceTest`: five tracks run to completion under the real foreground service with verified files, byte totals known and the service stopping itself afterwards; a missing source fails one track and the other four finish). One earlier run had a failure in the existing `searchAndVoiceRequestsFindAndQueueTracks`; my fixtures at that point reused the "ZZ Artist" name that test searches. After renaming them the full run passed 20/20. I did not re-run it a second time to prove the cause.
- Typecheck of desktop, desktop-electron and contracts passes; the built bundle contains the new status UI.
- Release APK published, `apksigner` verified, local and public SHA256 match `330e9c428c6d92c98579398a013db39e91979bf6e18eef03fdbbd2dc7b8fcf15`; installed on the emulator, launched, no crash.

## Not verified
- A real Jellyfin download of a playlist, with the screen off or the app backgrounded, and across a Wi-Fi to mobile switch. (The behaviour is covered by the JVM resume/retry tests and the emulator service test, not end to end.)
- The new status card was typechecked but not viewed on a screen; layout (a top-right card, full width on phones) is unreviewed.
- Notification permission on Android 13+: if the user has denied it the service still runs but its notification is hidden.
- Android 15 limits `dataSync` services to about 6 hours per day; `onTimeout` stops the service cleanly and the next enqueue or relaunch resumes the partial files.
- Only the first 5 attempts without progress are made per track; after that it shows as failed and "Retry failed" resumes from the saved part.
