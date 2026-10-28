# S009 — Core screens: Library, Now Playing, Queue

Version: versionCode 10 / 0.2.9-s9, APK SHA256 `70521f1e3e8c1fd2861fef7f3e60c9cf9fd4c9261f0fc05f899e4995e224c2b1` (public bytes verified).

## Changes
- Library: prominent **Shuffle all** (turns shuffle on, starts at a random track of the filtered list with the list as context); eyebrow and lede hidden on phones so the list starts higher.
- Now Playing: artwork capped on phones so shuffle/prev/play/next/repeat, volume and the new **Start radio** / **Save radio as playlist** buttons all fit above the nav.
- Queue: unchanged; already has Shuffle/Repeat/Clear toggles (verified Shuffle on after Shuffle all).
- Context menu clipping fixed in S008 (bottom sheet on `<body>`).

## Evidence (emulator, Android 16)
- Shuffle all -> Queue shows "Shuffle on", Seed Song playing; Now Playing shows shuffle active. `s009-now-playing.png`.
- playback-core vitest passes; production build succeeds.

## Not verified
- Shuffle all randomness is not asserted automatically (random start; native shuffle order owned by ExoPlayer, covered by S002 tests).
- Larger libraries (virtualized list performance), tablets/landscape, light theme re-check of new buttons.
