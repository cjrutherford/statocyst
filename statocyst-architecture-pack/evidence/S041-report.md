# Evidence report: S041 — Bathypelagic motion system

**Status:** VERIFIED (device acceptance recorded; numeric harness capture still open)
**Date:** 2026-11-06
**Branch:** feat/bathypelagic-motion (stacked on perf/capacitor-native-parity)
**Base:** S040 performance overhaul
**Reference device:** Google Pixel 10 Pro (physical), not connected to this build host

## Landed

### Screen transitions

- `ScreenTransitionService` owns every view change:
  - **Deep dive / surface** for anything involving Now Playing (`library → now`,
    `now → queue`, hardware back, Minimize). Uses the View Transitions API on the
    viewport-sized `main` scroller, with a CSS fallback for older WebViews.
  - **Foam bubble wipe** for Library, Playlists, Offline, Queue and Settings, plus
    every Settings tab change.
  - Reduced motion (OS preference) or a busy transition updates instantly, so taps
    are never dropped.
- Deep dive is 380 ms (transform/opacity only). Foam is 300 ms cover + 500 ms reveal
  (800 ms total). The page swaps under full foam; the bubbles disperse outward and
  fade during the reveal.
- The foam overlay covers only the content pane; the sidebar, player bar and mobile
  tab bar stay in place.
- The old view is given a water-gradient backing during a deep transition so it does
  not show through transparent panels.
- Settings tabs run through the same foam transition; keyboard arrow/Home/End moves
  focus to the new tab after the reveal.
- Now Playing Minimize and hardware back use the service, preserving the back stack.

### Ambient water and micro-interactions

- `UnderwaterBackdropComponent`: fixed caustic sheets, rising motes and depth
  vignette. 16 motes on desktop, 8 on native, paused when the document is hidden,
  removed under reduced motion.
- Sonar ring on the player-bar and Now Playing play buttons (one-shot, 900 ms).
- Favorite heart pop plus six rising bubbles (Now Playing).
- Download pill gets a bloom when it reaches the saved state.
- Light theme now has larger teal-edged motes, stronger foam edges and visible
  ambient bubbles (fixes the POC light-mode report).

### Proof of concept updates

- POC now includes the fifth foam sample.
- Foam bubbles disperse radially instead of rising straight up; reveal is 500 ms.
- Light-mode ambient bubbles are larger, teal-edged and carry a stronger glow.

## Verification

All commands from the repository root.

| Command | Result |
| --- | --- |
| `node_modules/.bin/nx build desktop --skip-nx-cache` | exit 0 |
| `node_modules/.bin/nx run-many -t typecheck -p contracts playback-core persistence media-library desktop desktop-electron --skip-nx-cache` | exit 0, 6/6 |
| `node_modules/.bin/nx run-many -t test -p contracts playback-core persistence media-library desktop-electron --skip-nx-cache` | exit 0, 5/5 |
| `node_modules/.bin/playwright test --config e2e/playwright.config.ts` | 5 passed, 2 failed — both pre-existing Settings tab expectations (see S040) |

Headless app harness (Chromium, mocked Capacitor bridge, 390 × 844):

- `sc-underwater-backdrop` renders 16 motes; foam overlay present.
- Library → Playlists: `.foam.is-covering` observed, Playlists rendered after 800 ms.
- Playlists → Offline → Queue → Settings: each destination rendered with the foam.
- Settings General → Storage: foam covering observed, Storage selected after 800 ms.
- Library → Now Playing: `data-transition="dive"` observed, Now Playing rendered.
- Now Playing → Minimize: `data-transition="surface"`, Library restored.
- Reduced motion: Playlists rendered immediately with no foam covering.
- Console/page errors: none.

## Per-screen walkthroughs

Recorded against the real Angular shell with a mocked Capacitor bridge, 390 × 844,
dark theme. Each clip shows the foam enter/leave or the deep dive/surface.

| Screen | File | Direct link |
| --- | --- | --- |
| Library | `evidence/videos/s041/01-library.mp4` | https://nirvana.tail5a4a0.ts.net/s041-videos/01-library.mp4 |
| Playlists | `evidence/videos/s041/02-playlists.mp4` | https://nirvana.tail5a4a0.ts.net/s041-videos/02-playlists.mp4 |
| Offline | `evidence/videos/s041/03-offline.mp4` | https://nirvana.tail5a4a0.ts.net/s041-videos/03-offline.mp4 |
| Queue | `evidence/videos/s041/04-queue.mp4` | https://nirvana.tail5a4a0.ts.net/s041-videos/04-queue.mp4 |
| Settings + tabs | `evidence/videos/s041/05-settings.mp4` | https://nirvana.tail5a4a0.ts.net/s041-videos/05-settings.mp4 |
| Now Playing | `evidence/videos/s041/06-now-playing.mp4` | https://nirvana.tail5a4a0.ts.net/s041-videos/06-now-playing.mp4 |

The links are served from the tailnet Funnel while the local `release/` HTTP server is
running. The MP4 files are committed under `evidence/videos/s041/`.

Screenshots:

- `evidence/screenshots/s041-app-library-dark.png`
- `evidence/screenshots/s041-app-foam.png`
- `evidence/screenshots/s041-app-now-playing.png`
- `evidence/screenshots/s041-app-library-light.png`
- `evidence/screenshots/s041-app-foam.gif`
- `evidence/screenshots/s041-app-deep-dive.gif`
- `evidence/screenshots/s041-poc-light-native.png` (light/native fix)

## Test build

- `release/statocyst-android-1.9.0-motion-test.apk` — signed with the usual release key
  (`7d850dae…e416`), same version 1.9.0 / versionCode 27 as S040's test build.
- SHA-256: `8678aac129dc7ea6f25fad11221d0fc1c0762370e07d82b73d0ad1bec1617a88`
- Download: https://nirvana.tail5a4a0.ts.net/statocyst-android-1.9.0-motion-test.apk
- This is a test build, not the tagged 2.0.0 release.

## Device acceptance

**2026-11-06, Pixel 10 Pro:** the user installed the signed test build and approved the
motion system ("this looks great and the performance is fantastic"). This covers the
touch-feel acceptance gate for the foam, deep dive, settings tabs and ambient layer.
Numeric gfxinfo/battery traces were not captured on this host.

## Not verified / blocked

- **Numeric device capture:** `tools/android-perf.sh` was not run against the 2.0.0
  build; the qualitative acceptance is recorded above. Frame and battery numbers can be
  added without changing the code.
- **Electron visual pass:** the desktop tier uses backdrop blur and the full ambient
  layer; screenshots/video on the packaged Electron build are not captured here.
- **2.0.0:** not tagged. Await device verification and approval.
- **Physical device walkthrough:** the MP4s above are headless captures with a mocked bridge;
  the Pixel still has to confirm touch feel and frame pacing.

## Next steps

1. Install a build containing S040 + S041 on the Pixel 10 Pro.
2. Run the per-screen walkthrough on device: lateral foam, settings tabs, deep dive
   in/out, reduced-motion setting.
3. Run `tools/android-perf.sh`; confirm no regression against S040.
4. Mark S041 `VERIFIED`, bump to 2.0.0 / versionCode 28, tag `v2.0.0`.
