# Evidence report: S051 — iOS podcast playback and downloads

**Status:** IMPLEMENTED_UNVERIFIED (iOS CI build passes; device playback evidence pending)
**Date:** 2026-11-08
**Depends on:** S046, S047, S050

## Landed in 2.1.1

- `PlaybackManager.resolvePlaybackURL` now streams podcast enclosure URLs through
  `AVPlayer` when no verified download or cache copy exists.
- Podcast artwork is resolved from the media item's cached `artworkPath` for Now Playing
  and CarPlay.
- `setRate`/`currentRate` add podcast speed control to the native player; the rate is
  applied whenever playback starts or resumes.
- Native podcast resume positions are written back to `podcast_episode` every five seconds
  while an episode is playing.
- `DownloadAndCache` treats podcast enclosures as remote media and pins them through the
  existing background download session; verified downloads keep precedence during playback.
- The shared renderer podcast queue context now drives the native iOS queue through
  `setQueue` once podcast data is available.

## Verification

- iOS Simulator Debug and Device Release builds pass in GitHub Actions run `42522311443`.
- Compilation includes the shared renderer podcast bridge and native plugin methods.
- No simulator/device playback session has been run from this Linux host.

## Still pending

- Play/pause/seek/speed/resume on a simulator or iPhone.
- Lock-screen/Control Center metadata and artwork.
- Background audio and process-death resume.
- Airplane-mode playback of a pinned episode.
