# S014 — Jellyfin integration tests (gap-closure slice 14)

Date: 2026-10-28. Test-only slice: no product code changed, so **no new APK was published** (current published build is
versionCode 14 / 0.3.3, SHA256 `323b2f7f…c77d`).

## What was added
- `FakeHttpServer` (JVM, socket-based; now handles POST bodies and HEAD) and `JellyfinClientTest` (8 tests) driving the real
  `JellyfinClient` / `JellyfinAuth` / `JellyfinArtwork` code against an in-process fake Jellyfin:
  - `discover`: parses public info; rejects a non-Jellyfin product.
  - `authenticate`: success; wrong password -> HTTP 401 error; server-identity mismatch rejected; credentials only in the POST body,
    login request carries a header with no `Token=`.
  - `instantMix`: token only in the `Authorization` header (never in the URL), ids parsed, items without ids skipped, expired token -> error.
  - `listAudioItems`: paging by `StartIndex` until `TotalRecordCount`; no token in any URL.
  - `probeStream`: HEAD `/Audio/<id>/stream?static=true`, true only for an authorized session.
  - Quick Connect initiate -> status -> authenticate.
  - Header scoping: `isServerUri` only matches the signed-in scheme/host/port; artwork rejects unsafe ids.
- `testImplementation org.json:json:20240303` so `org.json` works in JVM tests.

## Verification
Unit tests: 57/57 (`./gradlew :app:testDebugUnitTest`).

## Not verified
Still no run against a real Jellyfin server: the fake encodes the documented API shapes, not any particular server version
or reverse-proxy behaviour (Authentik/Authelia etc.).
