# Statocyst 2.2.0 — video podcasts and podcast UI

**Release date:** 2026-11-12
**Version:** `2.2.0` (`versionCode 52`, iOS build 52)

## Added

- Video podcast episodes in RSS/Atom feeds: video-only and audio+video enclosures,
  alternate forms, a Video filter, and video episode metadata.
- Video is the default presentation for an episode with a video form. Audio-only is an
  explicit per-episode toggle.
- A live video preview in the mini player and a full-screen podcast Now Playing view with
  seek, skip, speed, audio-only and native picture-in-picture.
- **Settings → General → Privacy → Reanalyze artwork**, which clears cached cover/artist
  images, bumps the artwork URL generation and refreshes the library.
- Podcast discovery shelves, search, richer show cards, and show-level playback settings.
- A grab handle and upward drag on the mini player; the player bar background between
  the artwork and transport creates room for the podcast title.

## Changed

- Podcast show/settings sub-screens use the foam bubble transition.
- MusicBrainz covers require the album title **and** artist to match; a different release
  by the same artist is rejected. Embedded/local artwork is the fallback when no online
  cover exists.
- The native video surface is confined to the mini player and Now Playing. It is gated on
  an active renderer host and cannot be reattached over other screens by media events.
- Android and iOS use the native network state (`ConnectivityManager`) for the offline
  banner instead of trusting the WebView's `navigator.onLine`.
- A stalled source now reads **Reconnecting…** instead of claiming the device is offline.

## Fixed

- A podcast refresh answer of `304 Not Modified` no longer clears the episode list.
- Quick Connect handles expired codes and Jellyfin 12.1's required user selection; an
  unreachable server address is rejected instead of silently saved.
- Tapping the mini player opens its full-screen player; the paused video frame redraws
  after returning from PiP or another screen.
- The native queue is not re-serialized on every buffering/timeline event; mobile
  discovery cards skip the expensive entrance animation and backdrop blur.

## Verification

- `versionCode 52` / `2.2.0` release APK installs over the QA build and preserves data.
- Emulator checks: inline video, mini-player preview, upward drag, audio-only toggle,
  PiP (video only), paused-frame restore, and Settings artwork reanalysis.
- `ExternalArtworkTest` covers album-scoped MusicBrainz matching.
- All four CI checks pass: web typecheck/test/build, Android unit tests/debug build,
  Android instrumented tests, and the iOS sideload IPA build.

## Not verified

- iOS video playback and PiP at runtime (CI compiles the IPA; no device was available).
- Play Store upload/signing; this release uses the local release key and a GitHub tag.
