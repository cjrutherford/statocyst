# S006 — Security and robustness

Build: versionCode 7 / 0.2.6-s6. Published APK SHA256 `4cc014ea71979f92adb2cc915f232d1ad670d02a8ee6f042d85143d18b780a86`.

## Delivered
- `JellyfinAuth`: the Jellyfin session token is sent only in the `Authorization` header. Removed `api_key` from every native URL: player stream, rolling cache, downloads, stream probe, artwork. ExoPlayer and the artwork `BitmapLoader` use a `ResolvingDataSource` that adds the header only for requests to the signed-in server (same scheme, host and port), so redirects, CDNs and the local media server never receive the token.
- `ControllerPolicy`: `onGetLibraryRoot`, `onGetChildren`, `onGetItem`, `onSearch`, `onGetSearchResult` return PERMISSION_DENIED unless the caller is this app, a Media3-trusted controller (system apps / media-control holders) or a known Auto/Assistant/car package.
- Car notice row ahead of the folders: "Your library is empty", "You're offline" (remote tracks + no network), "Jellyfin is signed out".
- `PlaybackFailures`: a failed song sends a `SessionError` with an actionable message (sign-in expired / no connection / no longer available / generic), then the player skips on as before.
- Plugin `io{}` now rejects the JS call on exception instead of leaving the promise pending (25 call sites).

## Verified
- Unit tests pass (23 browse + 3 auth + 3 policy/failure + 1).
- Instrumented tests 6/6 on emulator-5554.
- End to end against a fake Jellyfin on the host via `adb reverse` (the app refuses cleartext to 10.0.2.2, as intended): requests were `GET /Audio/zz2/stream?static=true` with `auth_header=True api_key_in_url=False`, and the track played. The rolling-cache prefetch used the same header.
- Wrong token: the server answered 401, the player logged `ERROR_CODE_IO_BAD_HTTP_STATUS`, and playback skipped to the next track.

## Not verified
- Controller denial is unit-tested only; no second app was available to attempt a denied browse.
- The notice rows and the `SessionError` text are not seen on a real Auto screen (no DHU/head unit).
- WebView `<img>` artwork (`capacitor-bridge.ts`) and the browser-only fallback stream URL still use `api_key`; WebViews cannot set headers, so this needs a native image proxy or a signed local URL (candidate for slice 8/9 work).
- Allow-list could lock out an unlisted head-unit browser package; check logcat for `browse denied for <pkg>` if the car shows an empty or missing list.
