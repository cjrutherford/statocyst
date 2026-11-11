# Video podcasts and optional YouTube sources

**Status:** Proposed (2026-11-11). Not yet accepted; the YouTube companion in particular
needs an explicit product/legal decision before implementation.
**Date:** 2026-11-11
**Target:** MVP-6 — Video podcasts, with optional desktop YouTube ingestion (S054–S062).
**Related:** ADR-019 (background playback), ADR-029 (security), ADR-033 (libSQL Android),
ADR-036 (podcasts), `roadmap/VIDEO_PODCASTS.md`.

## Context

MVP-5 made podcast episodes a first-class media kind and gave them their own persisted
queue, resume state, playback speed and skip intervals. Playback is audio-first: the
renderer owns one `<audio>` element, Android owns an ExoPlayer/media session, and iOS owns an
AVPlayer with a background audio session.

Two user needs sit outside that model:

1. Some podcasts publish video (a `video/*` enclosure, or an audio and a video alternate).
   Statocyst currently plays only the primary enclosure and has no video surface, so a
   video-only episode is treated as audio or fails depending on the platform decoder.
2. Some shows publish only on YouTube. Users want podcast-length YouTube videos (roughly
   20–90 minutes) treated like podcast episodes so they can listen in the background
   without the YouTube application or a YouTube Premium subscription.

The second need cannot be met by the official YouTube API. Google's API Developer Policies
prohibit background play (`a player that is not displayed in the page, tab, or screen that
the user is viewing`), separating or promoting audio-only components, and downloading
audiovisual content. The YouTube Terms of Service separately prohibit accessing content
through means other than the playback pages, embeddable player, or other authorized means.
Any implementation that extracts a YouTube stream or plays YouTube audio in a hidden
player is therefore **against YouTube's terms**, regardless of which library performs the
extraction. It can also break without notice as YouTube changes clients, PO-token
requirements and rate limits.

Statocyst must not hide that trade-off inside the core player, and must not make the
licensing and App Store consequences of extraction the default experience for every user.

## Decision

1. **Video is a presentation of a podcast, not a new media kind.**
   Podcast episodes keep `media_kind = 'podcast'`. A new `media_form` (`audio` or `video`)
   records the primary presentation, and an `alternates` list records every usable
   enclosure. A video podcast is still a podcast: it uses the existing podcast queue,
   resume state, played state and download pipeline. `MediaKind` remains `music | podcast`;
   a future standalone video library would need its own decision.

2. **Background-first playback.**
   The audio pipeline is authoritative; video is an attached surface. When the app is
   backgrounded, minimized, screen-locked or in audio-only mode, the video surface is
   detached and audio continues on the existing engine (Chromium media element on desktop,
   Media3 on Android, AVPlayer/AVAudioSession on iOS). Video must never be the only reason
   audio can continue. PiP and fullscreen are presentation features layered on top, not
   separate players.

3. **RSS video podcasts are the compliant path.**
   Video enclosures published by the podcast's own feed are fetched, parsed and played
   through the existing protocol. No extraction, no new source of truth. This path works
   on every platform and is the recommended way to listen to video podcasts.

4. **YouTube is an optional source adapter behind a local companion, not core code.**
   Statocyst core contains no YouTube downloader, stream extractor, PO-token provider or
   cookie handling. It discovers YouTube items through public metadata (channel RSS and,
   when available, the official Data API) and asks a separately installed, user-run
   **Statocyst Companion** for a playable stream. The companion owns yt-dlp/ffmpeg,
   cookies, PO tokens, rate limiting and updates. It exposes a versioned, authenticated,
   same-machine or LAN HTTP contract; Statocyst persists only a bridge id and an obfuscated
   pairing token, never the media URL or cookies.

5. **No re-hosting, no redistribution and no persistent YouTube downloads.**
   The companion resolves media for the local user and streams it to the paired Statocyst
   instance. Statocyst does not run a public proxy, publish an aggregate feed, cache or
   redistribute YouTube content, strip ads, or offer downloads to third parties. YouTube
   episodes are **streaming-only**: the pin/download action is not offered for a YouTube
   source, because persistent copies would add a separate ToS and copyright exposure on top
   of stream extraction. A future hosted service or a YouTube download feature would be a
   different product and is out of scope.

6. **Duration-based classification is explainable and reversible.**
   A YouTube item is classified as a podcast episode when the user added the channel or
   video as a video podcast, or when it passes the feed's configured duration rule (default
   minimum 20 minutes, preset "podcast length" 45 minutes), and is not a Short, live or
   upcoming stream. Classification is stored with a reason and can be overridden per
   episode or per channel. A single video URL shows a confirmation before import. Music
   videos, clips and Shorts are not silently converted.

7. **Desktop first; platform honesty after that.**
   The companion and YouTube source ship on Electron desktop first. Android may use the
   same companion over authenticated LAN, or a separate optional plugin later; it does not
   gain a bundled GPL extractor or a Python runtime in the core app. iOS does **not** ship
   YouTube extraction: there is no supported on-device extractor, and an App Store build
   that does this is a rejection risk. iOS supports RSS video podcasts only. Car surfaces
   remain audio-only and never render video.

8. **Explicit opt-in, explicit consequences.**
   The YouTube source is off until the user enables it, shows a plain-language notice that
   the feature is unofficial, may violate YouTube's terms, may stop working and is for
   content the user has the right to access, and links to the companion's own licence and
   documentation. Store listings and release notes do not advertise "background YouTube
   playback". The feature is labelled experimental.

## Required implementation controls

- No extraction dependency may enter `libs/contracts`, `libs/podcast-core`, the Electron
  main bundle, the Angular renderer, the Android core module or the iOS app target.
  Extraction lives in the companion process and is reached only through the bridge.
- The companion endpoint is an explicit user-configured value with a pairing token. Never
  proxy arbitrary URLs supplied by feed content; only resolve episode ids that belong to a
  paired source.
- Feed bodies, media URLs, cookies, PO tokens and pairing tokens never enter logs, support
  bundles or `app_state`. Redact to hostname/hash as the existing podcast policy requires.
- Keep the existing single-authoritative-queue invariant. Video presentation cannot create
  a second player, queue or background session.
- Do not weaken the MVP-5 release gate. MVP-6 is planned separately; if video support is
  folded into a 2.1.x release, the MVP-5 gate must still pass first.
- Record a BLOCKED gate, with a reproduction recipe, when a platform cannot meet its
  background, PiP, App Store or legal gate. Do not claim parity by compilation.

## Consequences

- Desktop migration 7 adds `media_form`, alternate-enclosure and source-kind columns, plus
  a classification reason, to the existing podcast tables. It is additive; no media kind
  or queue table is rebuilt.
- Android Room moves v7 → v8 and iOS schema 6 → 7 with the same additive columns. The
  locked-screen/background tests from MVP-5 are reused and extended for video surfaces.
- The playback contract gains `mediaForm` and `presentation`, and the engine load request
  gains the poster/alternate metadata needed to choose a `<video>` surface.
- The protocol resolver gains a YouTube remote kind that calls the companion at play time;
  resolved URLs are cached in memory only because they expire.
- The renderer gains a video stage, PiP, fullscreen and audio-only controls. The mini
  player keeps a poster/thumbnail; it does not become a second video element.
- Download size becomes materially larger for RSS video episodes. Video pins are opt-in and
  share the existing quota; audio-only alternates can pin a smaller audio stream. YouTube
  episodes remain streaming-only.
- The project accepts a maintenance and support burden for the companion, but not a core
  licence or App Store burden. iOS feature parity for YouTube is explicitly not promised.

## Verification

See `roadmap/VIDEO_PODCASTS.md` and slices S054–S062. This ADR asserts no passing test and
no platform support. The companion's live YouTube behaviour is never a CI gate; the
contract is tested against a fixture bridge, and live resolution is recorded as manual,
time-boxed evidence with the exact date and companion version.
