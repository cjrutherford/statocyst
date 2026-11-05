# Evidence report: S040 — Capacitor native-parity performance overhaul

**Status:** IMPLEMENTED_UNVERIFIED (device gates pending)
**Date:** 2026-11-05
**Branch:** perf/capacitor-native-parity
**Base:** `origin/main` @ `76f4039` (1.9.0 / versionCode 27)
**Reference device:** Google Pixel 10 Pro (physical) — not connected to this build host

## Landed

### Startup and bridge

- `CapacitorBridge.stats()` now uses the native `libraryStats` aggregate; it no longer calls
  `listTracks()` a second time. A cold start performs exactly one full catalog transfer.
- `LibraryStore.init()` paints the library from `listTracks()` and loads the decorative counts
  in the background.
- Settings load runs its Preferences reads in parallel and caches the result in memory (11
  reads, one wall-clock cost). `SettingsStore` and playback share the cache.
- The shell bootstrap runs settings, playback and library in parallel; downloads initialize in
  the background. `app.info()` no longer blocks the shell.
- Added renderer marks `statocyst:boot-start`, `statocyst:library-ready` and
  `statocyst:shell-interactive`.
- `PlaybackStore` keeps high-frequency position in dedicated `positionMs`/`durationMs` signals.
  `positionChanged` no longer replaces the coarse snapshot signal. Initial reads are guarded by
  revisions so a parallel event cannot be overwritten by a stale snapshot.

### Rendering

- The library track table is windowed: fixed 61 px rows, 10-row overscan, spacer rows, and a
  measured table offset. 10,000 rows render ~32 real rows instead of 10,000.
- Added a synchronous `[data-native]` profile (set in `main.ts` before bootstrap) that keeps the
  ocean/bubble palette and both themes but removes the expensive WebView paint paths:
  live `backdrop-filter` on fixed chrome, `background-attachment: fixed`, the pearl blur filter,
  and the animated play-button shadow. Body gradients remain; sonar/float motion stays on
  transform/opacity.
- Equalizer bars animate `transform: scaleY()` instead of height.
- `contain: layout paint style` on list rows and cards; native scrolling uses
  `scroll-behavior: auto` and `overscroll-behavior-y: contain`.
- Edge-to-edge phone layout uses safe-area insets; the Now Playing transport spans the content
  width at 360, 390 and 430 px.

### Now Playing

- One full-width transport row on phones: favorite, shuffle, previous, play, next, repeat,
  volume. Seven symmetric columns keep the play button exactly centred.
- Volume trigger moved into the transport row; its popover is anchored to the trigger and stays
  inside a 390 px viewport.
- Favorite action on the current track (heart outline/filled, `aria-pressed`, optimistic).
- Download action on the current track: Download → Downloading n% → Saved offline (tap to
  remove); local/demo tracks read "On this device". The action is only offered for
  `sourceKind === 'jellyfin'`, using the new optional `Track.sourceKind` field (additive
  contract; Electron playback snapshots now preserve it).
- Desktop keeps the existing transport row with the volume trigger inline and a new
  favorite/download affordance.

### Android

- `MainActivity` no longer force-resumes the WebView on pause or holds an app-level partial wake
  lock. Playback stays in the Media3 foreground service, which now uses
  `setWakeMode(C.WAKE_MODE_NETWORK)` while playing. The plugin re-emits state and queue on
  resume so the paused WebView catches up with native changes made from the notification.
- WebView background is the abyss colour and overscroll glow is disabled.

## Verification run

All commands run from the repository root unless noted.

| Command | Result |
| --- | --- |
| `node_modules/.bin/nx build desktop --skip-nx-cache` | exit 0 |
| `node_modules/.bin/nx run-many -t typecheck -p contracts playback-core persistence media-library desktop desktop-electron --skip-nx-cache` | exit 0, 6/6 tasks |
| `node_modules/.bin/nx run-many -t test -p contracts playback-core persistence media-library desktop-electron --skip-nx-cache` | exit 0, 5/5 tasks |
| `node_modules/.bin/nx build desktop-electron --skip-nx-cache` | exit 0 |
| `JAVA_HOME=/opt/android-studio/jbr ANDROID_HOME=$HOME/Android/Sdk ./gradlew :app:compileDebugKotlin :app:compileDebugJavaWithJavac` (in `android/`) | BUILD SUCCESSFUL |
| `node_modules/.bin/playwright test --config e2e/playwright.config.ts e2e/now-playing-phone.spec.ts` | 1 passed |
| `node_modules/.bin/playwright test --config e2e/playwright.config.ts` | 4 passed, 3 failed — the three failures are pre-existing on the base commit (see below) |

### Pre-existing e2e failures (not introduced by S040)

1. `desktop.spec.ts` expects `Database healthy` on the default Settings tab; the latest UI moved
   diagnostics behind the Diagnostics tab.
2. `privacy.spec.ts` expects the `Server URL` field without opening the Jellyfin tab.
3. `a11y.spec.ts` light-mode nav-label contrast on the active nav item.

The same failures are reproducible from the base layout (Settings is tabbed and the nav is
unchanged by this slice).

### Headless measurements (Chromium, mocked native bridge)

- Startup call counts with one track: `listTracks=1`, `libraryStats=1`, `prefsGet=11` (parallel).
  `statocyst:shell-interactive` at 64 ms after boot start in the mock shell.
- 10,000-track library: 32 real `tr.track-row` elements, table scroll height 610,462 px, no
  blank gap at scrollTop 300,000; rAF cadence p50/p95 = 17 ms during a scripted scroll.
- Phone transport (360/390/430 px viewport): controls start at x=14 and span 332/362/402 px;
  play centre equals viewport centre (180/195/215); volume occupies the rightmost cell; volume
  popover stays inside the viewport (x=104..374 at 390 px).
- Favorite click: `aria-pressed` false → true.
- Download click: label `Download` → `Downloading` (mock queue).
- Native profile computed styles: `backdrop-filter: none` on player/sidebar,
  `background-attachment: scroll`, `.stage__pearl { filter: none }`.

Screenshots:

- `evidence/screenshots/s040-now-playing-phone-dark.png`
- `evidence/screenshots/s040-now-playing-phone-light.png`
- `evidence/screenshots/s040-now-playing-volume-popover.png`
- `evidence/screenshots/s040-library-10k-virtualized.png`

## Test build

- `android/app/build/outputs/apk/release/app-release.apk` (4.4 MB), version 1.9.0
  (versionCode 27), signed with the expected certificate
  (`7d850dae…e416`). Copied to `release/statocyst-android-1.9.0-s040-test.apk`
  with SHA-256 `393880e1cab7f1eaab42cfbeffb1edc12d2279bc066f5fe434cfc4fc9e4564d7`.
- Not published as the stable `statocyst-android.apk`; no version bump or tag yet.
  The tailnet Funnel answered 502 at capture time, so the APK has to be installed
  over USB or after the Funnel server is started.

## Not verified / blocked

- **Physical-device performance:** no adb device was connected to this host
  (`adb devices` was empty). The Pixel 10 Pro cold-start, jank and battery gates are therefore
  not measured. Use `tools/android-perf.sh` with the installed build and record
  `evidence/s040/{device,cold-start,frames,meminfo}.txt`.
- **Real Android playback regression:** native compile passes; background playback, lock screen,
  notification and Android Auto need an on-device pass after the lifecycle change.
- **10k library on device:** the DOM windowing and frame numbers above are Chromium headless;
  they must be repeated on the Pixel.
- **Release:** not built or tagged yet. Version bump and signed release await device verification
  and approval.

## Next steps

1. Install the new build on the Pixel 10 Pro (`tools/android-publish.sh` after sync, or a local
   debug APK).
2. Run `tools/android-perf.sh`; compare cold start, jank and memory against 1.9.0.
3. Exercise background playback, notification controls, seeking, favorites, download/remove and
   a 10k-track scroll on the device.
4. Mark S040 `VERIFIED` only with those numbers; then bump to 1.10.0 / versionCode 28 and tag
   `v1.10.0`.
