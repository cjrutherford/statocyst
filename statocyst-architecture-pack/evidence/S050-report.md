# Evidence report: S050 — iOS podcast data and ingestion

**Status:** BLOCKED (macOS/Xcode unavailable on this host)
**Date:** 2026-11-08
**Depends on:** S044, S045

## What exists

- iOS schema v6 and the podcast tables/`mediaKind` column were added in S042.
- The shared renderer podcast bridge (`createCapacitorPodcastBridge`) is platform-neutral
  and is exposed on Capacitor only when the native host implements `listPodcastFeeds`.
- `CapacitorBridge` hides the Podcasts bridge on iOS today, because no native data methods
  exist there. The Podcasts view therefore shows the desktop-host explanation instead of
  calling missing methods.
- `trackDict` carries `mediaKind`; podcast `artworkFor` is not yet wired on iOS.

## Why this is BLOCKED

This build host is Linux. `xcodebuild`, the iOS simulator and a signing/provisioning
environment are unavailable, so a Swift data layer cannot be compiled, installed or
verified here. Writing unverified Swift would violate the slice completion rule.

## Reproduction recipe

On a macOS host with Xcode and a simulator/device:

1. Implement `PodcastTransport.swift` with `URLSession` conditional GET, redirect and size
   limits, SSRF checks and Podcast Index SHA-1 signing.
2. Add `PodcastRepository.swift` over `StatocystDatabase` to save feeds/episodes into the
   S042 tables plus `media_item` rows with `mediaKind='podcast'`.
3. Add the plugin methods named in S048 (`fetchPodcastText`, `listPodcastFeeds`,
   `listPodcastEpisodes`, `getPodcastEpisode`, `savePodcastFeed`, `updatePodcastFeed`,
   `removePodcastFeed`, `setPodcastEpisodePlayed`, `cachePodcastArtwork`,
   `podcastDirectoryStatus`, `setPodcastIndexCredentials`,
   `clearPodcastIndexCredentials`, `podcastIndexSearch`).
4. Store the Podcast Index key/secret in Keychain; never in SQLite or logs.
5. Run `xcodebuild` for the App target, then add a feed, restart and verify the library and
   artwork on a simulator/device.

## Evidence decision

BLOCKED. Do not claim iOS podcast support until the recipe is implemented and evidence is
recorded.
