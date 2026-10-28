# Android Auto overhaul — slice 2: single native player (versionCode 3, 0.2.2-s2)

Environment: Android 16 emulator (sdk_gphone64_x86_64), real Jellyfin library (2147 tracks), debug APK.

## Verified (emulator)
- Tapping play in the library starts playback in the native ExoPlayer: `dumpsys media_session` shows
  `state=PLAYING`, metadata "Eat The Elephant, A Perfect Circle", queue size=250 (library context window).
- Shuffle + repeat taps are applied natively: first skip from index 0 landed on index 157 of 250;
  `statocyst_queue.xml` holds `shuffle=true`, `repeatMode=2`.
- Force-stop + relaunch restores the queue (250), the shuffled position ("Zombie — Bad Wolves", paused),
  and the shuffle/repeat state in the UI. Screenshots: evidence/screenshots/s002-*.png.
- Unit tests: 70/70 (vitest). New: play-with-context, shuffle over context, repeat-all single-entry fixes.

## Not verified
- Desktop Head Unit / real car (DHU not installed on this machine). Slices 4-5 own that gate.
- Notification / lock-screen controls (slice 3), hardware buttons, Bluetooth.
- Rolling-cache prefetch after the move to native playback was wired but not exercised.

## Known issues carried forward
- SystemUI `MediaBrowser onConnectFailed` for PlaybackService in logcat (media-resume probe) — slice 3/5.
- Two notifications still possible (hand-built FGS notification + Media3's) — slice 3.
- Library boot takes ~10 s on a 2147-track library before the UI appears — not investigated.
- "Play all shuffled" is limited to a 250-track window (binder size); paging is a later improvement.
