# S015 — Device matrix (gap-closure slice 15)

Build: versionCode 15 / 0.3.4, SHA256 `e8a2403025028ee11340c8708082f00ce4f2a2194c91aa2696a76793bef3ed98`
Published: https://nirvana.tail5a4a0.ts.net/statocyst-android-debug.apk (public bytes verified equal to local).

## What was added
- `tools/android-seed-fixtures.py` — pushes `fixtures/audio` into the app and seeds 12 tracks (long, unicode, Japanese titles).
- `tools/android-device-matrix.sh` — drives the emulator through 7 configs and captures Library / Now Playing / Queue / Settings for each into `evidence/s015/`; restores display settings on exit.

## Configs captured (emulator-5554, Android 16)
phone-default (1080x2400 @420), phone-small (720x1280 @320), phone-font13 (font scale 1.3), phone-small-f13, phone-dark, tablet-portrait (1600x2560), tablet-landscape (2560x1600, sidebar layout).

## Findings and fixes (web only)
- Now Playing on phones: long titles/artists overflowed and the cover pushed the transport row under the bottom nav. Fixed with clamped title size, 3-line title / 2-line artist clamps, and a height-aware cover cap (`24vh` on short viewports) in `now-playing.component.ts`.
- Short phones hid the mini-player on Now Playing, leaving no reachable transport at large font. The hide rule in `app.component.ts` now applies only at `min-height: 761px`.
- Library, Queue, Settings, dark theme and both tablet layouts rendered cleanly with no changes.

## Limits
- Single emulator, no physical devices; font-scale 1.3 on the default phone leaves the play button flush against the bottom nav edge (fully tappable, no overlap with controls).
- Small phone at font 1.3 scrolls Now Playing; transport is available through the mini-player.
- Native code untouched; unit (57) and instrumented (10) suites were not rerun for this slice.
