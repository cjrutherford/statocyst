# Video podcasts

**Status:** Accepted design intent (scope confirmed 2026-11-11); implementation unverified.
**Date:** 2026-11-11
**Target:** MVP-6 — Video podcasts on desktop, Android and iOS (S054–S061).
**Related:** ADR-019 (background playback), ADR-029 (security), ADR-033 (libSQL Android),
ADR-036 (podcasts), `roadmap/VIDEO_PODCASTS.md`.

## Context

MVP-5 made podcast episodes a first-class media kind with their own persisted queue,
resume state, playback speed and skip intervals. Playback is audio-first: the renderer owns
one `<audio>` element, Android owns an ExoPlayer/media session, and iOS owns an AVPlayer with
a background audio session.

Some publishers distribute video podcasts: a `video/*` enclosure, or an audio enclosure
and a video alternate in the same item. Statocyst currently reads only the primary
enclosure and has no video surface, so a video-only episode is treated as audio or fails
depending on the platform decoder. Users cannot watch the video they subscribed to, and
audio/video alternates are not preserved.

YouTube ingestion is **not** part of this decision. The official API does not permit
background play, audio separation or downloading, and extraction-based approaches are
against YouTube's terms, fragile across SABR/PO-token/client changes, and not viable on
iOS. Statocyst will not ship a YouTube extractor or companion in this milestone. Supporting
a publisher's own RSS video feed is the compliant path and is the only video source in
scope.

## Decision

1. **Video is a presentation of a podcast, not a new media kind.**
   Podcast episodes keep `media_kind = 'podcast'`. A new `media_form` (`audio` or `video`)
   records the primary presentation; an `alternates` list records the other usable
   enclosures. A video podcast still uses the existing podcast queue, resume state, played
   state and download pipeline. `MediaKind` remains `music | podcast`; a future standalone
   video library would need its own decision.

2. **Audio is authoritative; video is an attached surface.**
   When the app is backgrounded, minimized, screen-locked or in audio-only mode, the video
   surface is detached and audio continues on the existing engine (Chromium media element
   on desktop, Media3 on Android, AVPlayer/AVAudioSession on iOS). Video must never be the
   only reason audio can continue. PiP and fullscreen are presentation features layered on
   the existing player, not separate players or queues.

3. **Only publisher feeds are a source of truth.**
   Video enclosures and audio/video alternates are fetched, parsed and played from the
   podcast's own RSS/Atom feed through the existing SSRF/URL gate. Statocyst does not
   extract streams from third-party video platforms, does not run a downloader companion,
   and does not add yt-dlp, ffmpeg, Python, NewPipe or similar dependencies to any core
   artifact. A user who wants a YouTube-only show must use the publisher's podcast feed or
   the YouTube app.

4. **Audio is the default when both forms exist; the feed/tier decides what is available.**
   If an item publishes audio and video, audio is the primary for background listening and
   video is retained as an alternate. A feed-level preference can choose video as the
   default. Some publishers expose different enclosures by subscription tier (for example,
   a member feed with video and a public feed with audio); Statocyst uses whichever feed the
   user actually subscribed to and never guesses a tier or fetches a different one. If the
   subscribed feed is video-only, video is the effective source. The user can switch
   presentation at any time without losing position. MVP-6 does not add premium/member-feed
   authentication or a feed-URL importer; it respects whatever feed is already in the
   library.

5. **Downloads are per episode, publisher-authorized and user-chosen.**
   Video pins are a user action, never automatic. The download sheet offers the original
   enclosure, an audio-only copy, or a compressed video copy where the platform can produce
   one. It shows an estimated size, shares the existing quota and can be removed cleanly.
   Compression is a fixed set of spoken-word/space-saving presets, not a general transcoder.
   Statocyst does not download from a third-party platform; it downloads the enclosure the
   publisher advertised.

6. **All three platforms ship together.**
   Desktop embeds video in Now Playing. Android and iOS use a native full-screen video
   surface plus native PiP in v1; an embedded mobile surface is a later refinement. Car
   surfaces remain audio-only and never render video. No platform is claimed VERIFIED until
   its background/screen-off and video-surface evidence exists.

7. **Video-only episodes stay in the podcast library.**
   A video-only episode is included in the normal episode list and queue, with a video
   badge and a **Video** filter. In audio-only mode it plays the audio track from the video
   container when the platform can decode it; if the codec is unsupported, Statocyst reports
   `UNSUPPORTED_MEDIA` rather than hiding the episode. A video episode is a video podcast
   because the publisher declared a video enclosure, not because it is long; duration is
   displayed, never used to convert arbitrary media.

## Required implementation controls

- Keep the existing single-authoritative-queue invariant. Video presentation cannot create
  a second player, queue or background session.
- Use the existing SSRF/URL policy for every enclosure, alternate and download. Only
  `http:`/`https:` is accepted; no `file:`, `data:`, `blob:` or platform-pseudo URLs.
- Preserve feed HTML safety: no raw show-notes HTML, no hotlinked remote artwork by
  default, no third-party tracking.
- Compression is limited to the download pipeline and fixed presets. Do not add a general
  video editor, arbitrary ffmpeg arguments or a transcoding service. Play the publisher's
  bytes when the user chooses the original; report `UNSUPPORTED_MEDIA` clearly rather than
  silently falling back.
- Compression must use platform-native transcode APIs on Android/iOS. Desktop compression
  uses a user-provided/system `ffmpeg` in v1; bundling an ffmpeg binary is a separate
  licensing/packaging decision.
- Do not weaken the MVP-5 release gate. MVP-6 is planned separately; if video support is
  folded into a 2.1.x release, the MVP-5 gate must still pass first.
- Record a BLOCKED gate, with a reproduction recipe, when a platform cannot meet its
  background, PiP or decoding gate. Do not claim parity by compilation.

## Consequences

- Desktop migration 7 adds `media_form` to `media_item`, a feed-level default form, and
  `media_form`/`alternates_json`/poster/video dimensions to podcast rows. It is additive; no
  media kind or queue table is rebuilt.
- Android Room moves v7 → v8 and iOS schema 6 → 7 with the same additive columns. The
  locked-screen/background tests from MVP-5 are reused and extended for video surfaces.
- The playback contract gains `mediaForm` and `presentation`; the engine load request gains
  the poster/form metadata needed to choose a `<video>` surface.
- The renderer gains a video stage, PiP, fullscreen and audio-only controls. The mini
  player keeps a poster/thumbnail; it does not become a second video element.
- Video pins can be large. The size estimate, quota, retention, compression and cleanup
  become part of the download UX. Android uses Media3 Transformer and iOS uses
  AVAssetExportSession; desktop requires an available `ffmpeg` or offers original/audio-only
  behavior only.
- YouTube and other third-party extraction remain out of scope. This avoids an unofficial
  ToS surface, GPL/Python packaging, App Store risk and a permanent maintenance treadmill.

## Verification

See `roadmap/VIDEO_PODCASTS.md` and slices S054–S061. This ADR asserts no passing test and
no platform support. Video playback, background audio, PiP, downloads and migrations must be
demonstrated on named runtimes and recorded in evidence.
