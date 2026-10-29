# Evidence report: S028

- **Status:** VERIFIED
- **Commit/branch:** main (uncommitted working tree; evidence captured 2026-10-28)
- **Environment:** Ubuntu 26.04 LTS, Node 24, Electron 45 (headless Ozone), Angular 22, Vitest 4, Playwright 1.57.
- **Gate:** secrets absent from logs/support bundle; export inspected manually.

## Files changed

- `apps/desktop-electron/src/main/logger.ts`
  - Added value-level `sanitizeText()` alongside key-based redaction. It removes bearer/basic credentials, `api_key`/`token`/`password` query parameters, inline `token=`/`password=`/`Authorization:` assignments, `MediaBrowser Token="…"` values, and `user:password@host` URL credentials.
  - Error messages and stacks now pass through the same scrubber.
- `apps/desktop-electron/src/main/support.ts` (new)
  - `collectHealth()` local checks: database integrity, schema version, data-directory read/write probe, log-file presence/size, free disk space vs cache budget. Every probe catches its own failure.
  - `buildSupportBundle()` composes app info, diagnostics, settings, health and the last 400 log lines, then runs the whole object through `redactValue()`. Includes an explicit privacy block (`externalReporting: false`).
- `apps/desktop-electron/src/main/ipc.ts` + `preload/preload.ts`
  - `app:health` and `app:export-support-bundle`. Export flushes the logger, reads the log, writes the bundle through a native save dialog, and logs the export event.
- `libs/contracts/src/lib/bridge.ts`, `channels.ts`
  - `HealthCheck`, `SupportBundleResult`, `AppBridge.health()`/`exportSupportBundle()`, new channels.
- `libs/contracts/src/lib/bridge.ts`, `apps/desktop-electron/src/main/settings-service.ts` (and renderer `settings.store.ts`, `capacitor-bridge.ts`)
  - `Settings.listeningHistory` (default **false**, validated as boolean).
- `apps/desktop-electron/src/main/playback-service.ts`
  - `markPlayed()` is gated on `listeningHistory`. When off, playback is unchanged but no play count or last-played timestamp is written (ADR-015 opt-in).
- Angular `settings-view.component.ts`
  - New "Local health checks" list with ok/warn/fail icons, an "Export support bundle" action, and a Privacy card with the local listening-history toggle and disclosure. The new card was added to the existing responsive grid.
- `apps/desktop/src/app/components/jellyfin-panel.component.ts`
  - Found while exercising the export: both Jellyfin forms submitted without `preventDefault()`, which made Electron navigate the `file://` document on Connect/Sign in. Both submit handlers now prevent default.
- Tests: `logger.spec.ts`, `support.spec.ts`, `settings-service.spec.ts`, `e2e/privacy.spec.ts`.

## Acceptance evidence

### Automated

```
vitest run --config apps/desktop-electron/vitest.config.ts
  Test Files 7 passed | 2 skipped (9)
  Tests     35 passed | 2 skipped (37)
```

New coverage:

- `sanitizeText` — bearer/basic, query credentials, inline token/password, URL credentials, and ordinary prose unchanged.
- `redactValue` — nested secret keys and error messages.
- `Logger` — real JSONL write contains no token/API key/bearer value.
- `buildSupportBundle` — fixture with five embedded secrets produces a bundle containing none of them, keeps `trackCount`/event names, and redacts a future secret-named settings field.
- `collectHealth` — healthy state, failed integrity + missing log, and a rejecting database probe (no throw).
- `SettingsService` — listening history defaults off, persists explicit choices, rejects non-booleans from a corrupt blob.

```
playwright test --config e2e/playwright.config.ts
  ✓ a11y dark (all views)   ✓ a11y light (all views)
  ✓ skip link               ✓ phone touch targets (all views)
  ✓ desktop import/playback/restart recovery
  ✓ privacy: support bundle export contains no secrets and records the privacy policy
  6 passed
```

The privacy e2e triggers a real failure by connecting to `https://alice:s3cret@127.0.0.1:1`, replaces only the native save dialog with a deterministic path, clicks the real **Export support bundle** button, and asserts the file, the rendered bundle and the on-disk JSONL log contain no `s3cret`, bearer values, API keys or `Token="…"`.

### Manual inspection of the artifact

A bundle was generated from a live app run and read in full (`/tmp/opencode/statocyst-support-review.json`, 2,847 bytes):

- `schema: 1`, app/versions, diagnostics (schema 5, integrity ok), settings (no secrets), five health checks, `privacy.externalReporting: false`, `listeningHistory: false`, and eleven recent log lines.
- The failure line appears as:

```json
{"timestamp":"2026-10-28T15:20:06.104Z","level":"warn","event":"jellyfin.server.add.failed",
 "data":{"url":"https://[redacted]@127.0.0.1:1","error":{"code":"UNREACHABLE","message":"The server did not respond"}}}
```

- `grep -c s3cret` on the bundle → `0`; no username (`alice`) present.
- The rendered Settings view was also reviewed: health rows show Database integrity (ok), Schema version (ok), Data directory (ok), Log file (ok), Free disk space (ok).

## Commands run (exit code)

```
vitest run --config apps/desktop-electron/vitest.config.ts       0
vitest run --root libs/<contracts|persistence|playback-core|
  media-library|jellyfin-client>                                0 (8/14/29/11/25)
playwright test --config e2e/playwright.config.ts                0 (6 passed)
tsc-rs --noEmit (desktop, desktop-electron)                     0
nx build desktop / desktop-electron                             0
```

## Safety / privacy notes

- No analytics SDK, uploader, crash reporter or third-party network client exists in the codebase; the only external calls are user-configured Jellyfin requests. The bundle's privacy block states this explicitly.
- Bundle export is user-initiated through a save dialog and is written locally; there is no background or scheduled upload.
- Listening history is off by default and gated at the single write site.
- Redaction is defence-in-depth: keys are redacted structurally and values are scrubbed textually.

## Known limitations / deferred

- Settings contents remain enabled in the bundle (they contain no secrets today). A future preference that is itself sensitive must be added to `SECRET_KEY` or excluded explicitly.
- Log rotation keeps one previous file (`statocyst.log.1`); bundles read only the current file.
- Android exports report that bundles are desktop-only; Android logs rely on logcat. This is disclosed in the native bridge.
- Human re-inspection of an exported bundle is trivial: Settings → Diagnostics → Export support bundle.

## Milestone gate affected

**Polish — S028: structured sanitized logs, local health checks, user-initiated redacted support bundle, and opt-in local listening history. Gate demonstrated.**

## Reviewer and date

Implementation agent — artifact inspected 2026-10-28; awaiting human review.

## Android parity verification (2026-10-28)

- **Environment:** Android SDK 36.1 emulator `Medium_Phone_API_36.1` (Android 16, API 36).
- **Implementation:** `Diagnostics` (database integrity, schema version, data directory, disk space, database size, downloads, cache, session), `SupportBundle` (JSON written to `files/support/…json`, share sheet via FileProvider), `capacitor-bridge.ts` adapters (`app.info`, `diagnostics`, `healthChecks`, `exportSupportBundle`), settings diagnostics card + Export support bundle button.
- **Gate demonstrated:**
  - Settings → Diagnostics rendered "Database healthy", "Migration 3 applied", 1000 KiB DB, downloads/cache/session checks, and "Storage pressure: Budget reduced to protect free space".
  - "Export support bundle" wrote `files/support/statocyst-support-…json` and opened the Android share sheet; the bundle's `privacy.externalReporting` is `false` and no token/API key/bearer value is present (secrets are redacted and Android logs go to logcat, so `logPath` is empty).
  - `app.info` reported `platform:"android"`, `android:"16"`, `device:"Google sdk_gphone64_x86_64"`, `dataPath:"/data/user/0/…/files"`.
  - The support-bundle settings block now reports the effective cache budget instead of `0` when the user has not set one explicitly.
- **Commands (exit code):** `gradlew assembleDebug` 0; `adb install -r` 0.
- **Residual:** physical device audit and real crash-log capture remain deferred.
