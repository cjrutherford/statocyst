# Handoff: Slice 20, reliable playlist downloads and explicit progress

Branch `android-auto-overhaul`, HEAD `280fd72` (v18 / 1.2.0, local only). Next release: versionCode 19 / "1.3.0".

## Goal
1. Playlist/album/artist downloads must not stop partway.
2. Download progress must be consistent and explicit everywhere in the UI.

## Diagnosis (read-only so far; nothing changed)
Why batches stop:
- The batch loop lives in the WebView: `DownloadsStore.downloadMany` (`apps/desktop/src/app/core/downloads.store.ts`) awaits one `downloadTrack` plugin call per track. When the screen turns off or the app is backgrounded, the WebView is throttled and the process can be killed, so the loop dies with nothing left to resume it.
- Native `downloads/DownloadManager.kt` runs inside a plain plugin call (`StatocystPlugin.downloadTrack`, ~line 443) with no foreground service. `FOREGROUND_SERVICE_DATA_SYNC` is not declared; only `mediaPlayback` is.
- No retry and no resume: any hiccup (30 s read timeout, network switch, 5xx) throws, deletes the `.part` file and the next attempt restarts from byte 0. A single transient error fails the track.
- Sequential only, so one slow track holds up the whole playlist.
- Failure counting is wrong: `download()` swallows errors and returns normally, so `failed` in `downloadMany` stays 0 and the final toast claims success.

Why progress is inconsistent:
- Native emits `downloadProgress` only every 256 KB, with no event for "queued", "retrying" or "waiting for network".
- The store has one `progress` signal for the current track and `batch.done/total` per track; bytes and per-track percent are not combined. `batchPercent` jumps only on whole tracks.
- The only progress UI is the `.dl-progress` block in `settings-view.component.ts` (~line 397); Library, Playlists and Offline views show no progress, only toasts.
- A track that fails shows only a transient toast; nothing lists what failed or lets the user retry.

## Proposed design
Native (Kotlin):
- New `downloads/DownloadService` (foreground, `foregroundServiceType="dataSync"`, add `FOREGROUND_SERVICE_DATA_SYNC` permission) owning a persistent queue (Room table or SharedPreferences) of trackIds with states: queued, active, retrying, failed, done.
- 2 concurrent workers; retry with backoff (e.g. 3 tries); resume via `Range: bytes=N-` on the existing `.part` (verify `206`, fall back to full restart on `200`); connectivity wait via `ConnectivityManager` callback; notification with "n of m, x%" and Cancel.
- Queue survives process death; service restarts and continues (`START_STICKY` or re-enqueue at app start).
- Plugin methods: `enqueueDownloads({trackIds})`, `cancelDownloads`, `retryFailedDownloads`, `getDownloadQueue` (snapshot) and a single `downloadQueue` event carrying the whole snapshot: per-track `{trackId, state, receivedBytes, totalBytes, attempt, error}` plus aggregate `{total, done, failed, receivedBytes, totalBytes}`. Throttle events to about 4/s.
- Keep `downloadTrack` for single downloads (route it through the queue).

Web:
- Contracts: `DownloadQueueSnapshot` type; optional bridge `enqueue/cancel/retryFailed/queue/onQueue` on `DownloadsBridge` (Electron keeps the old path).
- `DownloadsStore`: replace the JS loop with the snapshot signal, derive `batchPercent` from bytes, expose `failedTracks`.
- One shared `sc-download-status` component (bar, "12 of 40, 63%, 48 MB of 76 MB", current title, state text such as "Waiting for network" / "Retrying (2/3)", Cancel / Retry failed) mounted in the app shell so it appears on every view, and used in Settings/Offline/Playlists. Per-track row state (queued, spinner with percent, failed with retry).

## Tests to write
- JVM (FakeHttpServer, extend with Range support): resume from `.part` with 206, 200 fallback restarts, retry after 503 then success, gives up after N tries, queue state transitions, aggregate math.
- Instrumented: queue persists across service restart; foreground notification posted; enqueue 5 tracks against a fake HTTP server and see all complete after app backgrounded (`am send-trim-memory`/`input keyevent HOME`).
- Web typecheck; Playwright/browser smoke if available for the status component.
- Do NOT point tests at the real Jellyfin on host port 8096.

## Constraints / environment
- Export `JAVA_HOME=/opt/android-studio/jbr ANDROID_HOME=$HOME/Android/Sdk`; run gradle from `android/`; `adb` is at `$ANDROID_HOME/platform-tools/adb` (not on PATH); web via `node node_modules/.bin/nx ...` (no `npx`). The `desktop` project has only `build` and `typecheck` targets.
- Uninstall the release app before `connectedDebugAndroidTest` (signature mismatch), reinstall the release APK afterwards.
- Release: `bash tools/android-publish.sh --release`; evidence report `evidence/S020-android-auto-overhaul-report.md`; commit locally with trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; do not push.
- Baselines before this slice: 73 unit, 18 instrumented, all green.
