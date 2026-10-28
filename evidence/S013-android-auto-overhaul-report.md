# S013 — Jellyfin artwork without `api_key` (gap-closure slice 13)

Version: versionCode 14 / 0.3.3. Date: 2026-10-28.
APK: https://nirvana.tail5a4a0.ts.net/statocyst-android-debug.apk
SHA256: `323b2f7f74533e8b73101bccb11fe97334aa4b9e261fc19b0de0c4a8deb1c77d`

## Changes
- `JellyfinArtwork` (native): downloads `/Items/<id>/Images/Primary` with the `Authorization: MediaBrowser … Token=` header,
  validates id/tag (`[A-Za-z0-9-]`), requires a real image (magic-number sniff), caps size at 6 MB, no redirects, and keeps an
  LRU disk cache under `cacheDir/jf-art` (64 MB, pruned to 48 MB).
- `LocalMediaServer` gets `/__media/art?id=&tag=`, so the WebView loads artwork from `http://127.0.0.1:<port>` with no token
  in any URL. `StatocystPlugin.trackJson` supplies `artworkUrl` for Jellyfin tracks.
- `capacitor-bridge.ts`: `toTrack` uses the native `artworkUrl`; the `api_key` image URL and the server/token plumbing are gone.
  Without the native plugin (browser smoke test) Jellyfin tracks show no artwork.
- Test helper `FakeHttpServer` (socket-based, JVM) — reused by slice 14.

## Verification
- Unit tests: 49/49 (new `JellyfinArtworkTest` x5: header-only auth, query has no token, disk cache hit, 401/non-image not cached,
  injection-shaped ids/tags rejected with zero upstream requests, MIME sniffing).
- Emulator-5554: fake Jellyfin on the host via `adb reverse` (a real Jellyfin runs on host :8096 and was NOT used);
  seeded session prefs; `GET /__media/art?id=alb-1&tag=t1` -> 200 `image/jpeg`; upstream saw
  `/Items/alb-1/Images/Primary?maxHeight=300&tag=t1` with the Token header; second request served from cache (one upstream hit);
  `id=../x` -> 400. Fake session and port forwards removed afterwards; app data cleared.
- Instrumented suite 10/10. Published APK: local and public SHA256 match.

## Not verified / limits
- Artwork shown in the UI against a real Jellyfin server (route verified with curl, not visually).
- The browser fallback (no native plugin) still builds a stream URL with `api_key=` because an `<audio>` element cannot send headers; it
  is a dev-only path, never used in the Android app.
- Android Auto browse-tree artwork still uses the tokenless Jellyfin URL: the in-process bitmap loader authenticates it
  (now-playing/notification), but a head unit fetching it itself will get 401 for Jellyfin tracks.
- The loopback route is reachable by other apps on the device (like the file route); it serves only album art for the signed-in server.
