# Slice 3 — session/service correctness (versionCode 4, 0.2.3-s3)

Changes: Media3 1.4.1 -> 1.8.0; removed the hand-built startForeground(1) notification (Media3 owns the single
media notification + FGS state); POST_NOTIFICATIONS declared and requested at launch (API 33+); browse callbacks
(onGetItem/onGetChildren) and onAddMediaItems are async via one `future()` helper (no runBlocking on the session
thread); ExoPlayer wake mode NETWORK; unplayable items are skipped (bounded by queue size) and errors are logged.

Verified (Android 16 emulator):
- Fresh install shows the system notification-permission dialog (screenshots/s003-launch.png context: focus was GrantPermissionsActivity).
- After grant + KEYCODE_MEDIA_PLAY: restored queue resumes, session state=PLAYING.
- Exactly one app notification: id=1001, channel statocyst_media, MediaStyle, FOREGROUND_SERVICE flag (Media3's).
- compileDebugKotlin and testDebugUnitTest pass.

Not verified: DHU/car (slice 4-5), process-death resumption from SystemUI (`onPlaybackResumption` is slice 5),
error-skip path under real network failure, Bluetooth buttons.
