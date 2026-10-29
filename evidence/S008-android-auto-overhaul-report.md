# S008 — Mobile shell: compact mini-player, Now Playing hand-off

Version: versionCode 9 / 0.2.8-s8, APK SHA256 `cdfdb3c5391c201589ae0b272b0ff41b922ae77015122e2cfc3978b70bcc3bd4`
https://nirvana.tail5a4a0.ts.net/statocyst-android-debug.apk (public bytes verified against local SHA).

## Changes
- Phone (<=760px) mini-player is a single compact row: artwork, title/artist, previous/play/next, 2px progress hairline. Shuffle, repeat, seek and volume moved out of the mini-player (they stay in Now Playing and Queue). It previously occupied ~30% of the screen.
- Mini-player is hidden on the Now Playing view on phones so it no longer covers the transport controls.
- Track context menu (slice 7 follow-up): hosted on `<body>`, bottom sheet on phones, opaque panel — fixes the clipped/obscured menu; "Start radio" and "Save radio as playlist" are reachable.
- Existing: bottom nav, safe-area insets, `viewport-fit=cover`, Android SplashScreen theme (unchanged, verified present).

## Evidence (emulator, Android 16)
- `s008-library.png`, `s008-now-playing.png`; radio queue order in `s007-radio-queue.png`.
- playback-core vitest passes (desktop has no test target; production build succeeds).

## Not verified / deferred to S009
- Now Playing artwork is oversized on short phones; layout polish and prominent shuffle/repeat/Start radio belong to S009.
- No bottom-nav item is highlighted while on Now Playing.
- Dark mode, tablets/landscape, gesture-nav devices.
