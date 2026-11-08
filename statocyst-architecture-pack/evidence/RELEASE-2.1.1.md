# Statocyst 2.1.1 — Podcasts on iOS, Android Auto and CarPlay

**Release date:** 2026-11-08
**Version:** `2.1.1` (`versionCode 30`)

## Scope

2.1.1 extends the podcast feature to iOS and in-car browse surfaces.

### iOS podcast data and playback

- `PodcastTransport.swift`: URLSession transport with conditional GET, redirect
  revalidation, private/loopback/metadata address blocking, content-type allowlists and
  bounded feed/image sizes.
- `PodcastRepository.swift`: SQLite podcast feed/episode storage over the S042 tables,
  including media-item rows with `mediaKind = podcast`, favorite/settings preservation,
  played state and resume positions.
- `StatocystPlugin` podcast methods: fetch text/artwork, save/list/update/remove feeds,
  list/get episodes, played state and directory status. This exposes the existing shared
  renderer podcast bridge on iOS.
- `PlaybackManager` streams podcast enclosure URLs, applies playback rate, persists native
  podcast resume positions and supplies local artwork to Now Playing.
- `DownloadAndCache` can pin podcast enclosures for offline listening.
- Podcast artwork is served through the loopback media server from `podcast-art`.

### In-car browse and playback

- **Android Auto**: the media browse tree now exposes Podcasts → shows → episodes, with
  local artwork, queue context and playback through the existing native Media3 service.
  Music browse remains filtered to `mediaKind = music`.
- **CarPlay**: the audio scene adds a Podcasts section with subscriptions and episode
  lists. Episode playback uses the existing `PlaybackManager` queue and Now Playing
  artwork.

## Verification

- iOS simulator Debug build and device Release/sideload build pass in CI.
- Android unit tests pass, including the podcast browse-tree test.
- Android instrumented MediaBrowser test passes for Podcasts → show → episodes and queue
  construction.
- Shared web/typecheck/E2E suites pass.

## Still pending device evidence

- iOS runtime subscription, playback and downloads on a physical iPhone/simulator.
- Android Auto Desktop Head Unit or physical head-unit run.
- CarPlay simulator/head-unit run with the Apple entitlement.
- Physical Pixel podcast background/offline run.
- 100-subscription/10,000-episode performance and podcast a11y gates.

These are recorded as `IMPLEMENTED_UNVERIFIED` in S050–S053 rather than claimed as fully
verified.
