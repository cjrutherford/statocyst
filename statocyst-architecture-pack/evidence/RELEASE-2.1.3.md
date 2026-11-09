# Statocyst 2.1.3 — podcast resume and progress fixes

**Release date:** 2026-11-09
**Version:** `2.1.3` (`versionCode 32`, iOS build 29)

## Fixed

- Resuming a podcast no longer seeks back to a stale position. The renderer now
  reads the episode back from the host before playing, so the resume position
  used after `play` is current rather than the value captured when the episode
  list was first loaded.
- Selecting an episode in a queue resumes that specific episode at its own saved
  position instead of continuing another queue entry.
- **In progress** and **Continue listening** now refresh when the Podcasts screen
  opens and mirror the live playback position while listening, instead of staying
  blank until the app restarts.
- Android now persists per-episode podcast resume positions every five seconds,
  on pause and on seek. It also records `lastPlayedAt`/play count and marks
  naturally finished episodes complete.
- iOS resumes a restored podcast queue from the episode's saved position when the
  mini player starts it, and flushes resume progress on pause.

## Tests

- Added a playback-service regression test covering two episodes in one queue:
  choosing the first episode resumes it at its saved position rather than the
  second episode's position.
- Desktop playback, persistence, playback-core, contracts and media-library
  suites pass.
- The podcast Electron E2E passes.
- Android `compileDebugKotlin` succeeds.
