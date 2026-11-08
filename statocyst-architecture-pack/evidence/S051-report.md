# Evidence report: S051 — iOS podcast playback and downloads

**Status:** BLOCKED (depends on S050; macOS/Xcode unavailable)
**Date:** 2026-11-08
**Depends on:** S046, S047, S050

## What exists

- The shared renderer `PodcastPlaybackStore` and player-bar podcast mode are implemented
  and pass the desktop E2E.
- The Android native source path and renderer context split are implemented in S049.
- iOS still has only the music `PlaybackManager`, `DownloadAndCache` and schema v6.

## Why this is BLOCKED

There is no iOS data layer (S050) to play from and no macOS/Xcode toolchain to build,
install or validate `AVPlayer`, background audio, `MPRemoteCommandCenter`, Keychain or
`URLSession` transfers.

## Reproduction recipe

On macOS:

1. Complete S050.
2. Add a podcast context to `PlaybackManager`: persisted queue, per-episode resume,
   `AVPlayer.rate`, completion threshold, now-playing metadata/artwork and remote commands.
3. Resolve podcast media through the existing `LocalMediaServer` / enclosure URL path with
   the verified-download precedence.
4. Add podcast pins to `DownloadAndCache` and verify airplane-mode playback.
5. Run simulator and device checks for background/lock-screen audio, relaunch resume,
   speed and download cleanup.

## Evidence decision

BLOCKED, and it blocks the all-platform MVP-5 release.
