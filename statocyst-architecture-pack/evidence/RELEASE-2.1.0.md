# Statocyst 2.1.0 — Podcasts

**Release date:** 2026-11-08
**Version:** `2.1.0` (`versionCode 29`)

## Scope

This release adds the discovery-first podcast feature on desktop and Android:

- Keyless directory discovery through Apple Podcasts and Fyyd, with optional
  app-configured Podcast Index.
- Subscribed / Downloaded / Discovery tabs, with the shared foam tab transition.
- Discovery landing built from Apple's top-podcast chart, source-derived categories and
  category rows.
- One-tap subscribe; no user feed URLs, OPML source import or directory API keys.
- Separate podcast queue, per-episode resume, speed, skip intervals and played state.
- Offline episode pins and a Downloaded episode tab.
- Host-side feed fetching, parsing, persistence, refresh and artwork caching.
- Android native Room podcast storage, Media3 playback context split and local artwork
  serving.

## Platform status

- **Desktop (Electron, Linux/macOS):** implemented and verified by unit tests and the
  podcast E2E flow.
- **Android:** implemented and verified on the emulator, including live directory search,
  subscription, playback and real cover artwork.
- **iOS podcast data and playback (S050/S051):** **BLOCKED** — no macOS/Xcode on the build
  host.
- **Android Auto / CarPlay podcast browse (S052):** **BLOCKED** — native browse nodes and a
  head-unit run are still required.
- **All-platform MVP-5 gate (S053):** **BLOCKED** by the iOS/CarPlay items and pending
  physical Pixel, 100-subscription/10k-episode performance, and podcast a11y evidence.

This release does not claim “podcasts on all platforms”. The blocked slices remain recorded
in `slices/S050.md`–`S053.md` and their evidence reports.

## Verification

- Typechecks pass for contracts, podcast-core, desktop and desktop-electron.
- `podcast-core`: 26 tests.
- `desktop-electron`: 51 passed, 2 skipped.
- `contracts`: 9 tests.
- Podcast E2E: subscribe, discovery top/category data, cached artwork, playback,
  played state, download, Downloaded tab and queue persistence across views.
- Android emulator: live Apple/Fyyd search, real top-podcast chart with 27 categories,
  one-tap subscribe, 309-episode feed playback and cover artwork in the player bar.

## Local review builds

The review artifacts built before the version bump are documented in
`evidence/PACKAGING-podcast-test.md`. Tagged CI builds produce the 2.1.0 APK/AAB and
desktop packages.
