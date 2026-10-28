# S010 — Settings, onboarding guidance, release verification

Version: versionCode 11 / 0.3.0, APK SHA256 `f99044fa8d80763702b2b151c10c79d899afb97749ddef59f24b937f08cee02b`
https://nirvana.tail5a4a0.ts.net/statocyst-android-debug.apk (public bytes verified).

## Changes
- Settings: new "Car and Android Auto" card (Android only) with the sideload checklist (developer settings, Unknown sources, Customize launcher), what the head unit shows, and voice/radio tips.
- Onboarding: the existing Library empty state (import files/folder or sign in to Jellyfin) is the first-run path; S009 added Shuffle all and radio entry points.
- `android/RELEASING.md` section 8: per-build checks and the S019 gate. `S019-report.md` updated.

## Verification (final build)
- Kotlin unit: 38/38. Instrumented `MediaLibraryServiceBrowseTest`: 7/7 on emulator Android 16. Web `nx run-many -t test`: 6/6 tasks.
- Device matrix: one emulator (Android 16, 1080x2400). No physical phones, other API levels, tablets or landscape.

## S019 status: IMPLEMENTED_UNVERIFIED
The DHU gate was not run (no DHU in this workspace). Not marked VERIFIED. User-reported: playback visible on the car screen (slice 4); launcher icon unconfirmed.

## Known gaps
- WebView `<img>` artwork / browser-only fallback still uses `api_key` URLs for Jellyfin.
- Resumption restores the queue, not the position; context queues cap near 300 items.
- `ControllerPolicy` allowlist may block an unlisted head-unit package (look for `browse denied for <pkg>` in logcat).
- Debug-signed APK only; no release signing key.
