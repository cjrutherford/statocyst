# Evidence report: S052 — Podcast browse in Android Auto and CarPlay

**Status:** IMPLEMENTED_UNVERIFIED (Android Auto MediaBrowser test passes; DHU/CarPlay runtime pending)
**Date:** 2026-11-08
**Depends on:** S049, S051

## Landed in 2.1.1

### Android Auto

- `BrowseTree` adds a Podcasts folder, show nodes and episode nodes with stable
  `podcast-feed::<id>` / `track::<mediaId>@@podcast-feed::<id>` IDs.
- Episode nodes carry local `podcast-art` artwork and queue context so next/previous move
  within the selected show.
- `PlaybackService` loads Room podcast feeds/episodes into the browse data, keeps music
  browse filtered to `mediaKind = music`, and resolves podcast enclosures through the
  existing native queue and `SourceResolver` path.
- The Queue folder includes podcast media items.

### CarPlay

- `CarPlayBrowse` adds podcast subscriptions and episode rows with duration/download
  detail.
- `CarPlaySceneDelegate` loads podcast feeds and episodes into the existing browse snapshot
  and `tracksById`, so episode selection uses the existing CarPlay queue/playback path.
- Podcast artwork flows through `CarPlayArtwork` from the cached `artworkPath`.

## Verification

- Android unit tests pass, including `podcastFolderGroupsShowsAndEpisodes`.
- Android instrumented `MediaLibraryServiceBrowseTest` passes on the emulator, including
  `podcastShowBrowsesAndQueuesEpisodes` (Podcasts → show → episode → queue media ID).
- iOS CarPlay code compiles in the successful iOS CI build (run `42522311443`).
- CI Android instrumented job passes.

## Still pending

- Android Auto Desktop Head Unit or physical head-unit run with screen off/offline.
- CarPlay simulator/head-unit run with the Apple entitlement.
- Voice/Assistant podcast requests and platform-specific empty states.
