# Evidence report: S025

- **Status:** IMPLEMENTED_UNVERIFIED
- **Commit/branch:** main (uncommitted working tree; evidence captured 2026-10-28)
- **Environment:** Ubuntu 26.04 LTS, Node 24, Electron 45, Angular 22, libSQL (embedded), Vitest 4.
- **Files changed:**
  - `libs/contracts/src/lib/bridge.ts` — `Settings.cacheBudgetBytes` + `Settings.quality`; `CacheStats`/`CacheBridge`; `DiagnosticsInfo.cacheBytes`.
  - `libs/contracts/src/lib/channels.ts` — `cache:stats`, `cache:clear`, `cache:reconcile`.
  - `libs/persistence/src/lib/migrations.ts` — migration v5 `cache_entry` (track_id PK, local_path, size_bytes, last_access_at).
  - `libs/persistence/src/lib/database.ts` — `saveCacheEntry`, `touchCacheEntry`, `listCacheEntries`, `removeCacheEntry`.
  - `apps/desktop-electron/src/main/cache-manager.ts` (new) — LRU byte-budget eviction, reconciliation (stale manifest entries + orphan files), storage-pressure budget reduction, prefetch, verified cache lookup.
  - `apps/desktop-electron/src/main/cache-manager.spec.ts` (new) — 5 tests covering the acceptance gate fixtures.
  - `apps/desktop-electron/src/main/main.ts` — cache directory, `CacheManager` wiring, protocol preference order pinned download → cache → remote/local, lookahead prefetch on track change.
  - `apps/desktop-electron/src/main/playback-service.ts` — `onTrackChanged(current, next)` hook for bounded lookahead.
  - `apps/desktop-electron/src/main/settings-service.ts` — validates `cacheBudgetBytes` (32 MiB…1 TiB) and `quality`.
  - `apps/desktop-electron/src/main/ipc.ts` + `preload/preload.ts` — cache handlers and diagnostics `cacheBytes`.
  - Angular: `settings-view.component.ts` (cache budget, quality control, live cache stats, Check cache / Clear cache), `settings.store.ts` defaults, `capacitor-bridge.ts` persistence + native stub.
- **Acceptance criteria and actual observations:**
  - **Simulated cache eviction:** unit test inserts four 10-byte entries under a 30-byte budget; asserts total ≤ budget, total = 30, oldest entry gone, newest retained.
  - **Stale files:** reconciliation test deletes a tracked file, asserts the manifest entry is removed and `totalBytes()` returns 0.
  - **Orphan files:** reconciliation test places an untracked file in the cache directory, asserts `removedOrphans = 1`.
  - **Storage pressure:** `handleStoragePressure()` halves the effective budget (200 MB → 100 MB, floor 64 MB) and reports `pressure` in stats.
  - **No false offline indicators:** `getCached()` returns a path only when the file exists at the recorded size; the protocol falls back to remote/local otherwise. Pinned downloads are consulted first and live in a separate directory, so cache eviction cannot remove them.
  - **Configurable budget:** exposed in Settings, validated in the main process, persisted in `app_state`.
- **Commands run with exit codes:**
  - `vitest run --config apps/desktop-electron/vitest.config.ts` — 0 (19 passed, 2 skipped).
  - `vitest run --root libs/<contracts|persistence|playback-core|media-library|jellyfin-client>` — 0 (8/14/17/11/14 passed).
  - `tsc-rs --noEmit` (desktop, desktop-electron) — 0.
  - `nx build desktop` — 0; `nx build desktop-electron` — 0.
- **Tests not run (why):** Real disk-full and real network prefetch scenarios need a device/host fixture; the unit fixtures simulate the observable behavior.
- **Safety/security considerations:** cache files hold audio bytes only; no tokens are persisted. Prefetch uses the same `Authorization` header as streaming and refuses non-OK responses.
- **Known limitations and deferred follow-up:** Lookahead depth is one track (bounded by design); throughput measurement lands in S026. Android still uses the WebView audio path and has no rolling cache yet.
- **Milestone gate affected:** **Polish — S025: adaptive horizon cache implemented with budget, LRU eviction, reconciliation and storage-pressure handling; no false offline indicators.**
- **Reviewer and date:** Implementation agent — awaiting human review, 2026-10-28.

## Android parity verification (2026-10-28)

- **Environment:** Android SDK 36.1 emulator `Medium_Phone_API_36.1` (Android 16, API 36).
- **Implementation:** `MediaCache` (LRU, byte budget, `filesDir/cache`), `cacheStats`/`cacheClear`/`cacheReconcile`/`prefetch` native methods, `capacitor-bridge.ts` adapters, settings cache card with budget radios and `Check cache files` / `Clear cache`.
- **Gate demonstrated:**
  - `cacheStats` on the emulator returned `{"bytes":31706715,"budgetBytes":92090368,"entries":1,"pressure":true}` — the budget is clamped to a quarter of free space (floor 64 MiB) and `pressure` is set.
  - A 31,706,715-byte FLAC was prefetched into `files/cache` while a remote track played; `cacheStats` rose from 0 entries to 1 entry.
  - `cacheReconcile` removed 1 stale entry when the tracked file was deleted out-of-band.
  - `cacheClear` removed the cached track while the pinned download survived and playback continued; the UI toast read "1 cached track removed".
  - `playbackUrl` prefetches the next remote track into the rolling cache on every play.
- **Commands (exit code):** `gradlew assembleDebug` 0; `adb install -r` 0.
- **Residual:** real disk-full pressure test and physical-device LRU behaviour not exercised; unit fixtures cover those.
