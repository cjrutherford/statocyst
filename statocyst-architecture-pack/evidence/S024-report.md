# Evidence report: S024

- **Status:** IMPLEMENTED_UNVERIFIED
- **Commit/branch:** main (uncommitted working tree; evidence captured 2026-10-28)
- **Environment:** Ubuntu 26.04 LTS, Node 24, Electron 45, Angular 22, libSQL (embedded), Vitest 4.
- **Files changed:**
  - `libs/contracts/src/lib/bridge.ts` — `DownloadsBridge`, `DownloadView`, `DownloadProgress`, `DownloadSummary`, `DownloadStats`; `downloads` added to `StatocystBridge`.
  - `libs/contracts/src/lib/channels.ts` — `download:add/remove/list/stats/progress`.
  - `libs/contracts/src/lib/playback.ts` + `schema/playback.schema.json` — added `UNAUTHORIZED`, `INSUFFICIENT_SPACE` error codes (kept in lockstep).
  - `libs/persistence/src/lib/migrations.ts` — migration v4 `download` table (track_id PK, local_path, size_bytes, sha256, container, verified, created_at).
  - `libs/persistence/src/lib/database.ts` — `saveDownload`, `getDownload`, `listDownloads`, `removeDownload`.
  - `apps/desktop-electron/src/main/download-service.ts` (new) — downloads (Jellyfin stream or local copy) to a protected directory, hashes (SHA-256) + records size as a verified manifest; `getVerifiedDownload` returns null unless the file still exists at the recorded size (no false offline).
  - `apps/desktop-electron/src/main/main.ts` — instantiated `DownloadService`, `downloadsDirectory`, protocol `lookupTrack` prefers a verified local download for any source before remote/local path.
  - `apps/desktop-electron/src/main/ipc.ts` — download handlers + progress push.
  - `apps/desktop-electron/src/preload/preload.ts` — `downloads` bridge.
  - `apps/desktop-electron/src/main/download-service.spec.ts` (new) — 3 tests.
  - Angular: `downloads.store.ts` (new), `icon.component.ts` (download/offline icons), `capacitor-bridge.ts` (native stub), `app.component.ts` (init), `library-view.component.ts` (download button + badge + offline filter), `settings-view.component.ts` (Downloads management card).
- **Acceptance criteria and actual observations:**
  - **Verified manifests:** DownloadService writes SHA-256 + size and marks `verified`; `getVerifiedDownload` re-checks file existence + size before use. Unit-tested.
  - **Separate from evictable cache:** Downloads live in `dataDirectory/downloads` (no evictable cache exists yet; S025 adds the evictable cache and its eviction must never touch this directory).
  - **Airplane mode plays downloaded content:** Implemented via protocol preference (verified download served from disk). NOT demonstrated — requires a running Electron app + offline toggle on real hardware.
  - **Routine eviction preserves pinned media:** Enforced by directory separation; eviction (S025) operates on a different path.
- **Commands run with exit codes:**
  - `vitest run --config apps/desktop-electron/vitest.config.ts` — 0 (14 passed, 2 skipped).
  - `vitest run --root libs/contracts` — 0 (8 passed); `libs/persistence` 14; `media-library` 11; `jellyfin-client` 14; `playback-core` 17.
  - `tsc-rs --noEmit` (desktop, desktop-electron, contracts) — 0.
  - `nx build desktop` — 0; `nx build desktop-electron` — 0.
- **Tests not run (why):** Real-device airplane-mode playback requires the packaged app + network toggle; not available in CI.
- **Safety/security considerations:** Downloads never store credentials; only catalog metadata + file bytes. Download files carry no tokens. The `api_key` is used transiently in the stream request only.
- **Known limitations and deferred follow-up:** Android downloads (SAF) remain deferred; the Capacitor bridge returns a not-implemented result. Jellyfin artwork for a downloaded track is still fetched remotely (offline artwork is later polish).
- **Milestone gate affected:** **Polish — S024: protected downloads + verified manifests implemented and unit-tested; airplane-mode gate not demonstrated on hardware.**
- **Reviewer and date:** Implementation agent — awaiting human review, 2026-10-28.

## Android parity verification (2026-10-28)

- **Environment:** Android SDK 36.1 emulator `Medium_Phone_API_36.1` (Android 16, API 36), Gradle 8.14.3, JDK 21 (Android Studio JBR). APK rebuilt from latest source (debug, signed with the debug key).
- **Implementation:** `DownloadManager` (Room/SQLite `download` table, size + SHA-256 verification, `filesDir/downloads`), `StatocystPlugin.playbackUrl` returns the loopback media URL when a verified download exists, `capacitor-bridge.ts` download adapters (`downloads.supported = true` on Android), library-view download button + progress ring, settings Downloads card.
- **Gate demonstrated:**
  - Download `Eat The Elephant` (31,706,715 bytes): `{"sha256":"01412598421931ec35b2461a9c4b23446c7fa5effe6e16e083a4004aa3fc4c4d","verified":true}`.
  - `playbackUrl` returned `http://127.0.0.1:<port>/__media/file?path=…/downloads/jf-…flac` with `local:true`; the `<audio>` element loaded metadata, seeked to 200 s, `readyState=4`.
  - Airplane mode cold start: the app booted, the library loaded from the local catalog, the pinned track played and seeked from the loopback URL.
  - `removeDownload` deleted the managed file (`files/downloads` empty afterwards) and the UI showed "Removed download"; `downloadStats` returned `{"count":0,"totalBytes":0}`.
  - Stale manifest rows (files deleted out-of-band) are pruned on the next `list`/`stats`, so the UI never reports "3 saved · 0 B".
- **Commands (exit code):** `gradlew assembleDebug` 0; `adb install -r` 0; `tsc -p apps/desktop/tsconfig.app.json --noEmit` 0; `nx build desktop` 0.
- **Residual:** physical device + Android Auto head-unit verification outstanding (S023).
