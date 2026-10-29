# S017 — Final verification and release

Build: versionCode 16 / 1.0.0, release-signed. Published: https://nirvana.tail5a4a0.ts.net/statocyst-android.apk
SHA256 `a57926fda49aefd3d70833337824c20abd0d4bec335496a7f6f5953532ef056e` (public bytes equal local).

## Evidence
- Kotlin unit tests: 57/57 pass under the new applicationId.
- Instrumented tests on emulator-5554: 10/10 pass.
- Release APK installed on the emulator: launches, `versionCode=16 versionName=1.0.0`, not debuggable (`run-as` denied), `PlaybackService` registered as a MediaLibraryService under the new package. Screenshot: `evidence/s016/release-launch.png`.
- S019 updated to VERIFIED on the user's report that the DHU run works and the icon is listed.

## Not verified
- DHU not rerun on the 1.0.0 build; the DHU run the user reported predates the ID change.
- Not itemised by the user: browse folders, playback from browse, custom buttons, voice search.
- Jellyfin radio/artwork never run against a real server; Android Auto Jellyfin browse artwork is tokenless.
- One emulator only; no physical phone install of the release build by me.
- Shuffle order is not persisted; the browser-only fallback stream URL still carries `api_key`.
