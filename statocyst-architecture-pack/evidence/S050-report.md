# Evidence report: S050 — iOS podcast data and ingestion

**Status:** IMPLEMENTED_UNVERIFIED (iOS CI build passes; device runtime evidence pending)
**Date:** 2026-11-08
**Depends on:** S044, S045

## Landed in 2.1.1

- `ios/App/App/Plugin/PodcastTransport.swift`
  - `URLSession` fetch with conditional GET, redirect revalidation, request timeouts and
    bounded response sizes (15 MiB feed, 8 MiB artwork).
  - HTTP(S)-only URLs; embedded credentials rejected; loopback/private/link-local/metadata
    address blocking with the local-network setting.
  - XML/JSON/text feed content types and image content types.
- `ios/App/App/Plugin/PodcastRepository.swift`
  - A dedicated SQLite connection to the same database with WAL visibility.
  - Save/list/update/remove feeds; save/list/get episodes; played and resume state.
  - Media items with `sourceKind = podcast`, `mediaKind = podcast`, enclosure URL,
    duration, published metadata and cached artwork.
  - Directory data remains parsed by the shared renderer; iOS stores validated results.
- `StatocystPlugin` methods:
  `fetchPodcastText`, `cachePodcastArtwork`, `listPodcastFeeds`, `listPodcastEpisodes`,
  `getPodcastEpisode`, `savePodcastFeed`, `updatePodcastFeed`, `removePodcastFeed`,
  `setPodcastEpisodePlayed`, `podcastDirectoryStatus`.
- `LocalMediaServer` serves cached covers from the app-private `podcast-art` directory.
- `CapacitorBridge` exposes the shared podcast bridge on iOS once the native methods exist.

## Verification

- iOS Simulator Debug build: **success** in GitHub Actions run `42522311443`
  (`iOS build and sideload IPA`).
- iOS Device Release/sideload IPA build: success in the same workflow.
- Typecheck/web/Android CI jobs pass on the same commit.

## Still pending

- Runtime subscription/search/add-feed/restart checks on an iPhone or simulator.
- Physical iPhone background audio and download/offline checks.
- The shared podcast UI is exposed on iOS, but a runtime interaction log is still required
  before this is marked VERIFIED.
