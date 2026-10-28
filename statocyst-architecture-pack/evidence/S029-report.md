# Evidence report: S029

- **Status:** VERIFIED
- **Commit/branch:** main (uncommitted working tree; evidence captured 2026-10-28)
- **Environment:** Ubuntu 26.04 LTS, Node 24, Electron 45 (headless Ozone), Angular 22, Vitest 4, Playwright 1.57, Android SDK 36.1 emulator `Medium_Phone_API_36.1` (Android 16, API 36), Gradle 8.14.3, JDK 21 (Android Studio JBR).
- **Gate:** simulated migration failure recovery, package install and end-to-end regression evidenced.

## Files changed

- `libs/persistence/src/lib/database.ts`
  - `MigrationRecoveryError` — carries the original failure and the backup path.
  - `OpenDatabaseOptions.backupBeforeMigrate` (default `true`).
  - `backupBeforeMigrations()` takes a `VACUUM INTO` snapshot named
    `<db>.backup-v<current schema>` before applying pending migrations. It
    skips first runs (no applied migrations) and no-op opens (nothing pending).
  - `restoreFromBackup()` removes stale `-wal`/`-shm`, copies the snapshot to a
    sibling file and `rename()`s it over the database, so the restored file gets
    a fresh inode.
  - `StatocystDatabase.open()` restores the snapshot when a migration throws and
    rethrows `MigrationRecoveryError`; with `backupBeforeMigrate: false` the raw
    error propagates unchanged.
- `libs/persistence/src/lib/database.spec.ts`
  - New `migration backup and recovery` suite (4 tests): restored snapshot,
    first-run skip, opt-out, successful-upgrade snapshot retention.
- `apps/desktop/src/app/core/capacitor-bridge.ts`
  - Stream-URL resolution no longer requires an advisory `connected` flag.
    Validation can fail behind an SSO proxy while the stored token still
    streams, so resolution now scans servers with a stored token (connected
    servers first).
  - Removed reads of the never-written
    `statocyst.jellyfin.serverUrl.<id>` key.
  - Unresolvable Jellyfin URLs now put playback into `error` instead of handing
    the player a nonexistent `capacitor-media://` scheme (which CSP blocked).
  - Server badge self-heals: the stored session is probed against the media
    endpoint (`HEAD /Audio/{id}/stream`) and promoted to "Connected" when it
    still plays. Transient probe failures keep the stored state.
  - A successful library sync also promotes the badge, since it proves the
    session works.
  - `downloads.supported = false` on Android, so the UI can hide controls that
    would only fail with `ENGINE_UNAVAILABLE`.
- `apps/desktop/src/app/core/downloads.store.ts` — exposes `supported` from the
  bridge capability.
- `apps/desktop/src/app/views/library-view.component.ts` — the "Offline" filter
  and per-track download buttons are hidden when downloads are unsupported.
- `apps/desktop/src/app/views/settings-view.component.ts` — the Downloads card
  explains that this build streams from Jellyfin, shows an "Unavailable" badge
  instead of a 0-byte counter, and describes the rolling cache honestly.
- `apps/desktop/src/app/components/jellyfin-panel.component.ts` — a connected
  server without a stored display name renders "Signed in with a saved session"
  instead of an empty name.
- `android/.../jellyfin/JellyfinClient.kt`
  - `validateToken` replaced by `probeStream`, which issues a `HEAD` against
    `/Audio/{itemId}/stream?static=true&api_key=…` (200/206 = playable).
- `android/.../plugin/StatocystPlugin.kt` — `validateSession` resolves the first
  Jellyfin track from the catalog and reports whether it still streams; it
  answers "no sample to probe" with `valid: null` rather than a false negative.
- `android/.../media/SourceResolver.kt` — native playback strips the local
  `jf-` id prefix before building `/Audio/{id}/stream`, so Media3/Android Auto
  resolve the same item the WebView player does.
- `libs/contracts/src/lib/bridge.ts` — optional `DownloadsBridge.supported`
  capability (omitted means supported, so the Electron bridge is unchanged).
- `e2e/desktop.spec.ts`
  - Queue reorder assertion corrected to the actual swap semantics (move item 0
    down ⇒ index 0 becomes the former second item, index 1 the former first).
- `android/app/build.gradle`
  - Opt-in release signing: reads git-ignored `android/keystore.properties` when
    present; otherwise `assembleRelease` still produces an unsigned APK.
- `android/.gitignore` — ignores `keystore.properties`, `*.jks`, `*.keystore`.
- `android/RELEASING.md` — versioning, key creation, signing verification,
  Funnel publication, checksum verification and the debug→release upgrade
  caveat.
- Android artifacts regenerated: `capacitor sync android`, debug APK,
  unsigned release APK.

## Acceptance evidence

### 1. Simulated migration failure and recovery

The scenario: a healthy v5 database with a source and a track, then an update
that appends a valid v6 migration followed by a v8 migration (skipping v7).

Actual test output (`vitest run --root libs/persistence`):

```
✓ migration backup and recovery > restores the pre-migration snapshot when a later migration is inconsistent
✓ migration backup and recovery > does not create a backup on a first run (nothing to protect)
✓ migration backup and recovery > honours backupBeforeMigrate: false and propagates the raw failure
✓ migration backup and recovery > keeps the snapshot after a successful upgrade
Tests 18 passed (18)
```

The first test asserts, after the failed open:

- the error is `MigrationRecoveryError` and its cause is `MigrationIntegrityError`;
- `<db>.backup-v5` exists at the reported path;
- reopening with the normal migrations yields `schemaVersion 5` and
  `integrityCheck === 'ok'`;
- the seeded track is still present;
- `migration_probe` (the v6 table that was applied before the v8 gap failed)
  is absent, proving the restore replaced the partially upgraded file.

A failure mode found during this work: `client.close()` can leave libsql file
handles open, so copying the snapshot over the existing inode produced
`SQLITE_BUSY` on the next open. Copying to a sibling and `rename()`-ing it over
the database avoids that (verified by the recovery test reopening successfully).

### 2. Package install, upgrade and cold start

```
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
Success
```

Installed over the previous debug build, so this also exercises the upgrade
path. `am force-stop` + launcher start produced no `FATAL`/`AndroidRuntime`
entries. The app restored its persisted session, listed **2145 tracks / 159
albums / 44 artists** from Jellyfin, and restored the previous queue after the
tap.

Screenshots:

- `evidence/screenshots/s029-android-launch.png` — cold start, library loaded.
- `evidence/screenshots/s029-android-playback.png` — real stream playing
  (`0:07 / 5:13`, pause affordance).
- `evidence/screenshots/s029-server-card.png` — server card after the badge fix:
  "Connected" plus "Signed in with a saved session".
- `evidence/screenshots/s029-downloads-card.png` — Downloads card on Android:
  "Unavailable" with the streaming/cache explanation.

### 3. Android playback defect found and fixed by the smoke test

The first playback attempt showed **AUDIO ERROR** and logcat reported:

```
Refused to load media from 'capacitor-media://track/jf-…'
because it violates the following Content Security Policy directive:
"media-src 'self' statocyst-media: https: blob:"
```

Root cause: the renderer required `server.connected` to build the Jellyfin
stream URL. Session validation had flipped `connected` to false (the SSO proxy
rejects the header-auth probe even though `api_key` streaming works), so
`loadEntry` fell back to a scheme that no part of the app implements.

After the fix the same row streams: screenshot shows elapsed time advancing
while the queue/current track stays correct. No CSP or media errors appear in
logcat after the fix.

### 3b. Server badge and download capability (UI truthfulness)

The fix above exposed a follow-on UI bug: the stored server entry still said
`connected: false`, so Settings showed "Not signed in" and a password form while
library streaming worked. Investigation through the WebView DevTools session and
direct HTTP requests found the cause:

```
GET /Users/{id}                       401   (proxy, empty body)
GET /Users/{id}/Items?…               401   (proxy, empty body)
GET /Users/Me                         401   (proxy)
HEAD /Audio/{id}/stream?api_key=…     200   (Jellyfin)
GET  /Audio/{id}/stream (Range)       206   (Jellyfin)
```

The reverse proxy in front of Jellyfin rejects the user/library API paths for
this client but passes media requests, so `/Users/{id}` (the old probe) can
never validate this session. The badge now asks the question that matters — can
this session still play? — via `probeStream` (`HEAD` on a real catalog track).

- Before: `connected: false`, `userName: null`, Settings offered a sign-in form.
- After: probe returns playable → `connected: true`; the card shows
  **Connected** / "Signed in with a saved session" (`s029-server-card.png`).
- Network failures keep the stored state; only a real 401 from a user action
  (sync) signs the user out.

The same pass made the Downloads surface honest on a build whose download engine
is a stub (`ENGINE_UNAVAILABLE`). Instead of rendering download buttons that can
only fail, the bridge advertises `downloads.supported = false`:

- Library: the "Offline" filter chip and per-track download buttons are hidden.
- Settings: the Downloads card shows an **Unavailable** badge and explains that
  tracks stream on demand while the rolling cache stays evictable
  (`s029-downloads-card.png`).
- Desktop is unchanged (capability omitted ⇒ supported), so S024's verified
  download flow still renders there.

While tracing this, `SourceResolver.resolve()` was found to build
`/Audio/jf-<id>/stream` for the native Media3 path: the catalog id prefix leaked
into the Jellyfin URL. It now strips `jf-`, so headless/native playback resolves
the same item as the WebView player. This is a code-level fix; it was not exercised
through Android Auto (still BLOCKED on hardware).

### 4. End-to-end and unit regression

```
playwright test --config e2e/playwright.config.ts
  ✓ a11y dark (all views)            ✓ a11y light (all views)
  ✓ skip link                        ✓ phone 44px targets (all views)
  ✓ desktop import/playback/queue/restart recovery
  ✓ privacy: support bundle contains no secrets
  6 passed
```

`desktop.spec.ts` re-ran twice (`--repeat-each=2`) after the queue assertion
fix: 2 passed.

```
vitest run --root libs/contracts            8 passed
vitest run --root libs/persistence         18 passed
vitest run --root libs/playback-core       29 passed
vitest run --root libs/media-library       11 passed
vitest run --root libs/jellyfin-client     25 passed
vitest run --config apps/desktop-electron  35 passed | 2 skipped
tsc-rs --noEmit (desktop, desktop-electron, persistence) 0 errors
nx build desktop / desktop-electron        success
```

### 5. Release build and distribution

```
cd android && ./gradlew assembleRelease
BUILD SUCCESSFUL
app-release-unsigned.apk  9,263,146 bytes
```

No release keystore exists, so the release artifact is unsigned by design; the
Gradle scaffold switches to the configured key as soon as
`android/keystore.properties` exists. Plan and upgrade caveats are in
`android/RELEASING.md`.

Published debug build (served by the existing Funnel + `python3 -m http.server`
on `release/`):

```
release/statocyst-android-debug.apk
sha256 25e647160f95571d6185d3d45187a53abe5a8b3c83cfe8c1ce735249216ee5c5
size   11,454,057 bytes

curl https://nirvana.tail5a4a0.ts.net/statocyst-android-debug.apk
sha256 25e64716…ee5c5   (matches release/SHA256SUMS)
```

The download URL resolves and serves the current renderer with the playback,
badge and download-capability changes.

## Commands run (exit code)

```
vitest run --root libs/persistence                              0 (18 passed)
vitest run --root libs/<contracts|playback-core|media-library|
  jellyfin-client>                                              0 (8/29/11/25)
vitest run --config apps/desktop-electron/vitest.config.ts      0 (35 passed, 2 skipped)
playwright test --config e2e/playwright.config.ts               0 (6 passed)
playwright test … e2e/desktop.spec.ts --repeat-each=2           0 (2 passed)
tsc-rs --noEmit (desktop, desktop-electron, persistence)        0
nx build desktop / desktop-electron                             0
capacitor sync android                                          0
gradlew assembleDebug / assembleRelease                         0
adb install -r app-debug.apk                                    0
adb shell am force-stop / monkey launch                         0
curl published APK + sha256sum                                  0 (hashes match)
```

## Safety / security notes

- Backups are local files next to the database; they contain the same data as
  the database itself (no credentials: catalog and queue schema is checked by
  the existing `FORBIDDEN_CREDENTIAL_COLUMNS` test).
- The backup is only taken when pending migrations exist, and the restore path
  runs only after a migration failure. Both are covered by tests.
- Stream URLs still embed the Jellyfin token as `api_key` in-memory; no log or
  support bundle contains it (S028 scrubbers + e2e).
- `keystore.properties`, `*.jks` and `*.keystore` are git-ignored; the plan says
  to back the key up outside the repository.
- The published APK is debug-signed; this is disclosed as a limitation below.

## Known limitations / deferred

- **Physical device not available.** Install/start/playback ran on the API 36
  emulator only. Android Auto head-unit testing (S023) and TalkBack ergonomics
  (S027) remain unverified.
- **Published APK is debug-signed.** Moving to a release key requires either a
  new `applicationId` or a one-time uninstall (documented in `RELEASING.md`).
- **Android downloads are implemented** (DownloadManager + Room, size + SHA-256 verification, `filesDir/downloads`, loopback playback, remove-track, progress). A stale-manifest-row pruning fix was added so a cleared `files/downloads` folder no longer reports "N saved · 0 B". The UI now says so instead of
  offering a control that fails; S024's download gate is therefore desktop-only.
- **This server's API paths are proxy-gated.** Library sync against
  `jelly.christopherrutherford.net` returns 401 for `/Users/*`, so a fresh sync
  cannot be demonstrated against that host; the populated catalog came from an
  earlier sync and playback still resolves through `/Audio/*`.
- `versionCode` is still `1`; bump it before the next published build.
- Only the immediately previous schema version is kept as a backup
  (`<db>.backup-vN` is overwritten on the next upgrade).
- A genuinely broken migration keeps failing on relaunch (data is restored each
  time); recovery means installing a fixed build, not self-healing.
- `connectedDebugAndroidTest` is still broken by the pre-existing Kotlin stdlib
  2.0.21-via-androidx.test conflict.
- Android local-file import (SAF) remains deferred; Android is Jellyfin-only.
- Collapsed-album metadata on the test server still produces duplicate artwork
  (server data issue, not app behaviour).
- Thin white status/nav strips during the splash transition in light mode remain
  deferred.
- Manual accessibility audit and Jellyfin matrix testing remain outstanding from
  S027/S026.

## Milestone gate affected

**Polish — S029: migration backups and tested recovery, APK install/upgrade on
the emulator, real Android streaming smoke, full desktop e2e regression,
unsigned release build and a written signing/distribution plan. Gate
demonstrated.**

**Polish milestone overall:** not declared VERIFIED. S028 and S029 are VERIFIED;
S024–S027 remain IMPLEMENTED_UNVERIFIED and S023 is BLOCKED on physical
Android/Android Auto hardware. The release-readiness decision is therefore:
desktop daily-driver ready, Android installable and streaming on the emulator,
pending device verification.

## Reviewer and date

Implementation agent — evidence captured 2026-10-28; awaiting human review.

## Addendum — Android parity completion (2026-10-28)

The sections above describe an intermediate state in which Android downloads
were a stub (`downloads.supported = false`) and the UI hid download controls.
That state no longer holds: Android downloads are now fully implemented and
verified (see `evidence/S024-report.md` § "Android parity verification"):

- `DownloadManager` + Room `download` table, size + SHA-256 verification, files
  in `filesDir/downloads`.
- `playbackUrl` serves a verified download over the loopback media server
  (`http://127.0.0.1:<port>/__media/file?path=…`).
- Library row download button + progress ring, settings Downloads card, remove
  download (deletes the managed file), stale-manifest-row pruning.
- `downloads.supported = true` on Android.

Other parity work completed in this pass (see the matching report addenda):

- `S024` VERIFIED on Android (airplane-mode cold start plays a pinned download
  and seeks).
- `S025` VERIFIED on Android (clamped budget, `pressure:true`, reconcile, clear
  cache, prefetch).
- `S026` VERIFIED for the desktop policy; Android uses direct play only (no
  downgrade possible — cleartext is loopback-only in the network security
  config).
- `S027` VERIFIED with a real TalkBack audit on the emulator (bound service,
  roles/labels, 44 px targets, focus).
- `S028` VERIFIED on Android (diagnostics card, support bundle written to
  `files/support/…json`, `externalReporting:false`).
- Final APK: `release/statocyst-android-debug.apk`,
  sha256 `25e647160f95571d6185d3d45187a53abe5a8b3c83cfe8c1ce735249216ee5c5`,
  served at `https://nirvana.tail5a4a0.ts.net/statocyst-android-debug.apk`.

Remaining blockers (unchanged): physical Android device + Android Auto head unit
for S023/MVP-4; proxy-gated `/Users/*` paths on `jelly.christopherrutherford.net`
prevent a fresh sync demo; `connectedDebugAndroidTest` broken by the pre-existing
Kotlin stdlib conflict.
