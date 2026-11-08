# Evidence — podcast test packaging (2026-11-08)

**Purpose:** installable review builds for the podcast expansion.

## Artifacts

| Artifact | Path | SHA-256 |
| --- | --- | --- |
| Android signed release APK | `release/statocyst-android-2.0.0-podcast-test.apk` | `70576a3484cba467c6ab318cd1a16e1e731c5cb0988560eea0cb868156c3f364` |
| Linux `.deb` (amd64) | `release/statocyst-2.0.0-linux-amd64.deb` | `63f2e7d25b0f3a174597c81bebe7d476dc555a250728cf3b7badfbf2e449d264` |
| macOS Apple Silicon zip (unsigned) | `release/statocyst-2.0.0-mac-arm64.zip` | `502007a213cb6c70284a68c3082ecad4fe0d7ef8b0d828f8f26fa27c370e49bc` |
| macOS Intel zip (unsigned) | `release/statocyst-2.0.0-mac-x64.zip` | `2f7695573187aa8e6fe2a16a321464c91208408b42dcd80e2d8d3048212e912c` |

A combined checksum file is at `release/PODCAST-TEST-SHA256SUMS`. Mac install/verification
steps are in `release/statocyst-macos-testing.md`.

## Build commands

| Step | Command | Result |
| --- | --- | --- |
| Renderer | `NX_DAEMON=false pnpm exec nx build desktop --skip-nx-cache` | success |
| Electron host/preload | `node tools/build-electron.mjs` | success |
| Android web assets | `pnpm exec cap sync android` | success |
| Android release APK | `cd android && ./gradlew :app:assembleRelease` | BUILD SUCCESSFUL |
| Linux deb | `pnpm exec electron-builder --linux deb --config electron-builder.yml` | success |
| macOS arm64 | `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac zip --arm64 --config electron-builder.yml` | success |
| macOS x64 | `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac zip --x64 --config electron-builder.yml` | success |

## APK verification

- `apksigner verify --print-certs` reports Signer #1:
  `CN=Statocyst, O=Hopeful Aspirations Industries`,
  SHA-256 `7d850daeb5e087ff221cc8ae9c590c2d2b381c7c911c069ee148fda8ee7be416`.
- Installed on the `Medium_Phone_API_36.1` emulator and launched via
  `net.christopherrutherford.statocyst.MainActivity`; process stayed alive and the Library
  shell rendered.
- The Podcasts nav item is present with **Subscribed / Downloaded / Discovery** tabs.
- Discovery loads Apple's keyless top-podcast chart, resolves feeds via iTunes lookup, and
  renders real Top podcasts plus 27 categories grouped from the chart's own genres. Category
  taps return directory results (for example, True Crime returned 67 results).
- Search remains a secondary action; there is no feed/site URL field, no OPML import and no
  user API-key form.
- A real subscription (True Crime with Kendall Rae) fetched 309 episodes and played on the
  emulator. The now-playing bar and the subscription card both show the real cover artwork;
  a 15 MB feed cap and `text/javascript`/`text/plain` feed types are accepted.
- Android podcast covers are cached under `files/podcast-art`; the loopback media server now
  permits that app-private root, fixing 403 responses that previously hid all podcast covers.
- Discovery and search payloads are persisted for 30/15 minutes, and directory artwork is
  passed through the host image cache (300 px Apple variants, `statocyst-art://image/` on
  desktop, loopback `/__media/` on Android) instead of hotlinking remote URLs.
- Podcasts tab switches use the shared foam bubble wipe (`ScreenTransitionService.foamChange`),
  the same transition as Settings tabs; sections/cards keep the `rise`/`card-in` vocabulary
  and the global `prefers-reduced-motion` rule disables it.
- The initial player bar correctly shows music mode on a fresh install.

## Packaging notes

- The macOS zips are **unsigned**; the reviewer must right-click → Open (or remove the
  quarantine attribute as described in the handoff note).
- Both Darwin libSQL binaries (`@libsql/darwin-arm64`, `@libsql/darwin-x64`) were present in
  the zips, in addition to the Linux binaries.
- The `.deb` includes the Linux `@libsql/linux-x64-gnu` and `musl` native modules.
- The macOS zips verify the Electron desktop build only. They do not contain an iOS app and
  cannot verify S050/S051.
- `dpkg-deb -I` confirms package `statocyst` version `2.0.0`, amd64, MIT, with GTK/NSS/libsecret
  dependencies.
