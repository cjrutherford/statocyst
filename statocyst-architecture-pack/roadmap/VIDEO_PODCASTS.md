# MVP-6 — Video podcasts

**Status:** PLANNED (2026-11-11). Design intent only; no implementation is asserted.
**Decision record:** ADR-037.
**Slice range:** S054–S061.
**Depends on:** MVP-5 podcast gate (`roadmap/PODCASTS.md` §18). S054/S055 may start
earlier, but no MVP-6 release claim may precede a passing MVP-5 gate or an explicit
product decision to re-scope.

## 1. Objective

Extend the podcast experience without weakening the music player or the MVP-5 podcast
contract:

- Play **video podcast episodes** published by RSS/Atom feeds, with a real video surface on
  desktop and full-screen/PiP video on mobile.
- Keep **audio authoritative**: video is a presentation layer. Audio continues when the
  window is minimized, the app is backgrounded, the screen is locked, or the user chooses
  audio-only.
- Preserve **audio/video alternates**. Some shows publish both; the user can switch
  presentation without losing position.
- Pin video episodes for offline playback where the publisher's enclosure allows it, with
  size, quota, compression and cleanup handled honestly.
- Offer **compressed offline copies** (audio-only, 480p, 720p) for space-constrained
  devices, while keeping the original available.
- Ship on desktop, Android and iOS with independent evidence for each platform.

## 2. Non-goals

- **YouTube or any third-party video-platform ingestion.** No extractor, downloader
  companion, yt-dlp/ffmpeg/Python/NewPipe dependency, cookie handling or SABR/PO-token
  work. The official API does not permit background play, audio separation or downloads;
  extraction-based approaches are against YouTube's terms and are not viable on iOS. A
  user who wants a YouTube-only show must use its publisher podcast feed or the YouTube
  app.
- A general video library, music videos, video playlists, or a video discovery feed.
- Live streams, premieres, Shorts, chapters/transcripts, captions or comments.
- Re-hosting, redistributing or publishing podcast video, or running a media proxy.
- General-purpose video editing or arbitrary transcoding. MVP-6 offers only fixed
  compression presets in the download pipeline; the original enclosure is still available.
  Play the publisher's bytes when the original is chosen; report unsupported media clearly.
- Embedded video inside the mobile WebView in v1. Android/iOS use a native full-screen
  video surface and native PiP; an embedded surface is a later refinement.
- Background video decoding while the screen is off. Audio-only is the expected state.
- Cross-device video resume, casting, AirPlay/Chromecast.
- Automatic conversion of arbitrary feed items into video. `media_form` comes from the
  publisher's declared enclosure, not from duration or title heuristics.

## 3. Baseline and what changes

| Concern | MVP-5 baseline | MVP-6 change |
| --- | --- | --- |
| Media identity | `media_kind='podcast'`; one enclosure | `media_form` (`audio`/`video`) plus alternate enclosures |
| Feed parser | First valid enclosure wins | Collect all valid enclosures; choose a primary and retain alternates |
| Playback engine | One `<audio>` element; Media3/AVPlayer audio | Media element may be `<video>`; native video surfaces; audio remains authoritative |
| Contract | `Track`, `EngineLoadRequest` audio-only | `mediaForm`, poster, presentation mode, video metadata |
| Protocol | Podcast remote URL proxy | Same proxy, with video MIME types and Range/HEAD |
| Downloads | Audio episode pins | RSS video pins (manual, user-chosen), audio-only or compressed copy where supported |
| Platforms | Desktop, Android, iOS, Auto, CarPlay audio | Desktop embedded video; Android/iOS full-screen + PiP; car remains audio-only |
| Source policy | Publisher RSS/Atom discovery only | Unchanged: publisher RSS/Atom only, now including video enclosures |

## 4. Why YouTube is excluded

This is a deliberate product decision, not a temporary omission. The options were
evaluated and rejected:

| Option | Why not |
| --- | --- |
| Official Data API + IFrame player | Cannot legally background-play, separate audio or download; does not meet the goal |
| yt-dlp in core or a companion | Against YouTube ToS; breaks with SABR/PO-token/client changes; adds a permanent update and support treadmill |
| NewPipe Extractor / youtubedl-android | GPLv3 and/or a bundled Python runtime; large APK; Android-only; still against ToS |
| Project-hosted proxy/re-hosting | Redistribution and operating liability; unacceptable |
| Public Invidious/Piped | Unreliable, rate-limited, legally grey; not a dependency we can support |

The compliant path for a video podcast is the publisher's own RSS/Atom feed. Statocyst
should do that well rather than own a fragile extractor. This decision can be revisited
only with a new ADR that explicitly accepts the legal, platform and maintenance costs.

## 5. Architecture

### 5.1 Media model

Video is a **presentation of a podcast episode**. The existing `media_kind = 'podcast'`
stays; music queries and the one-authoritative-queue invariant are untouched.

```
podcast_feed (default_media_form = audio | video)
  └── podcast_episode (media_form = audio | video, alternates_json)
        └── media_item (media_kind = podcast, media_form = audio | video, path)
              └── podcast_queue_entry / download / cache
```

An episode can advertise both forms. `media_form` is the **primary** presentation;
`alternates` carries the rest. The UI shows a video badge when any form is video. Audio is
preferred as the primary when both exist, unless the feed preference is video. The effective
choice is constrained by the feed the user subscribed to; MVP-6 does not add premium/member
feed authentication or a feed-URL importer, so it never fetches a different tier on the
user's behalf.

### 5.2 Desktop schema — migration 7

Additive only. No table rebuild, no media-kind CHECK change, no queue rewrite.

```sql
ALTER TABLE media_item ADD COLUMN media_form TEXT NOT NULL DEFAULT 'audio'
  CHECK (media_form IN ('audio', 'video'));

ALTER TABLE podcast_feed ADD COLUMN default_media_form TEXT NOT NULL DEFAULT 'audio'
  CHECK (default_media_form IN ('audio', 'video'));

ALTER TABLE podcast_episode ADD COLUMN media_form TEXT NOT NULL DEFAULT 'audio'
  CHECK (media_form IN ('audio', 'video'));
ALTER TABLE podcast_episode ADD COLUMN alternates_json TEXT;
ALTER TABLE podcast_episode ADD COLUMN poster_url TEXT;
ALTER TABLE podcast_episode ADD COLUMN video_width INTEGER;
ALTER TABLE podcast_episode ADD COLUMN video_height INTEGER;

CREATE INDEX idx_podcast_episode_form ON podcast_episode(media_form);
```

Notes:

- `alternates_json` is a bounded array (max 8) of validated enclosures, excluding the
  primary. It is persisted in the same transaction as the episode.
- `poster_url` is the cached/validated image used as the video poster; the existing
  artwork fallback still applies.
- Video downloads reuse the existing `download` table; `media_form` is derived from the
  joined media item. No download schema change is needed.
- No platform-pseudo URLs, source-kind, external-id, classification or resolver columns
  are added. Enclosures are ordinary HTTP(S) URLs from the publisher.

### 5.3 Mobile schemas

- **Android:** Room v7 → v8. Add `mediaForm` to `MediaItemEntity`; add
  `defaultMediaForm` to `PodcastFeedEntity`; add `mediaForm`, `alternatesJson`,
  `posterUrl`, `videoWidth`, `videoHeight` to `PodcastEpisodeEntity`. Add the form index.
- **iOS:** `StatocystDatabase.SCHEMA_VERSION` 6 → 7 with idempotent guarded `ALTER TABLE`
  statements. Same columns and defaults.
- Both migrations are additive; existing music and podcast rows read as
  `mediaForm = 'audio'`.
- The MVP-5 tests for screen-off audio, process death and queue restore are extended, not
  replaced.

### 5.4 Contracts

```ts
export type MediaForm = 'audio' | 'video';
export type Presentation = 'audio-only' | 'video';

export interface PodcastEnclosure {
  url: string;
  type: string | null;
  form: MediaForm;
  lengthBytes: number | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
}

// Track gains:
//   mediaForm?: MediaForm;

// PodcastEpisode gains:
//   mediaForm: MediaForm;
//   alternates: PodcastEnclosure[];
//   posterUrl: string | null;
//   videoWidth: number | null;
//   videoHeight: number | null;

// PodcastFeed gains:
//   defaultMediaForm: MediaForm;
```

Playback contract additions:

```ts
export interface PlaybackSnapshot {
  // ...
  mediaForm: MediaForm;
  presentation: Presentation;
}

export type PlaybackCommand =
  // ...
  | { type: 'setPresentation'; mode: Presentation };

export interface EngineLoadRequest {
  // ...
  mediaForm: MediaForm;
  posterUrl: string | null;
}
```

`setPresentation` is a presentation request, not a queue command. It never loads a second
player. If both forms exist, the host may reload the engine at the current position; if
only one form exists, it only shows/hides the video surface.

### 5.5 Protocol and engine

- The protocol proxy keeps `statocyst-media://track/<id>` and Range/HEAD support. Video MIME
  types are added to the served-type allowlist; the upstream `Content-Type` is still passed
  through.
- `ProtocolTrack` gains `mediaForm` so the host can apply a size/type policy; the podcast
  remote remains `{ kind: 'podcast', url }` because video enclosures are ordinary URLs.
- Desktop: the renderer owns a `<video>` element for video tracks and keeps the existing
  `<audio>` element for audio tracks. Only one is active at a time. The video element has
  `playsinline`, a poster and no `disablePictureInPicture`.
- Android: Media3 remains the only player. A native `PlayerView`/`SurfaceView` is attached
  for full-screen/PiP; `clearVideoSurface()` on background/audio-only keeps playback alive.
- iOS: AVPlayer remains the only player. An `AVPlayerLayer` is attached for full-screen and
  `AVPictureInPictureController` for PiP; the layer is detached on background/audio-only.
- The engine reports duration and position exactly as it does for audio. Video dimensions
  are persisted from feed metadata (or reported by the surface) and are optional.

### 5.6 Presentation and background playback

| State | Desktop | Android | iOS |
| --- | --- | --- | --- |
| Now Playing, video mode | Embedded `<video>` in the stage | Full-screen native surface launched from the stage | Full-screen native surface launched from the stage |
| Mini player | Poster/thumbnail; no second video element | Poster in WebView; native surface hidden | Poster in WebView; layer hidden |
| Minimized/background | Audio continues; video hidden; optional PiP | Audio continues; surface detached; PiP if the user leaves video | Audio continues; layer detached; PiP |
| Screen locked | Audio continues (media session) | Audio continues (foreground media service) | Audio continues (`AVAudioSession.playback`) |
| Audio-only | Hide video, keep audio; choose audio alternate when available | Detach surface; select audio track/stream | Detach layer; select audio track/stream |
| Car | Audio only | Audio only | CarPlay audio only |

Desktop background rules:

- Keep `backgroundThrottling: false` for the main window, and start a
  `powerSaveBlocker('prevent-app-suspension')` only while audio is playing. Stop it on
  pause/end/error.
- Register `navigator.mediaSession` metadata and action handlers so OS media keys and the
  desktop media widget control the same authoritative queue.
- Do not require the window to stay visible. Closing to tray (if enabled) must pause only
  when the user chooses "quit"; otherwise audio continues.
- PiP uses `HTMLVideoElement.requestPictureInPicture()` where available; the button is
  hidden when unsupported. Fullscreen uses `requestFullscreen()`.
- Background CPU: no video frames are decoded when the surface is hidden. Measure battery
  and CPU on the reference machine; if hiding is insufficient, switch to an audio alternate
  for background playback. This is an explicit performance gate.

Mobile background rules:

- Android already uses `setWakeMode(C.WAKE_MODE_NETWORK)` and a media foreground service.
  MVP-6 must prove video does not break audio focus, notification actions or the media
  session when the surface is detached.
- iOS already holds `AVAudioSession.playback`. Adding `AVPlayerLayer`/PiP must not cause the
  session to deactivate on background. Screen-off audio is a required evidence item.
- Video is never decoded while the screen is off; the OS may stop decoding anyway. The
  product expectation is audio, not background video.

### 5.7 Feed ingestion: video enclosures

`libs/podcast-core` changes:

- Parse every valid enclosure/link, not just the first:
  - RSS `<enclosure>` and `<media:content>` (including `medium="video"`, `type="video/*"`,
    `width`, `height`, `bitrate`).
  - Atom `<link rel="enclosure">` and `<media:content>`.
  - Podcast 2.0 alternate enclosures where already represented as links.
- Classify form from MIME first, then `medium`, then a conservative extension/URL hint.
  `application/octet-stream` is not assumed to be video.
- Primary selection:
  1. If the feed has both audio and video, prefer **audio** as the primary for background
     listening and keep video as an alternate.
  2. If only video exists, primary is video.
  3. If the feed preference is `defaultMediaForm='video'`, prefer video.
- Validate every enclosure URL with the existing HTTP(S)/SSRF gate. Reject non-HTTP(S).
- `alternates_json` is bounded (max 8), sanitized, and persisted in the same transaction as
  the episode. Duplicate URLs collapse; the primary is not duplicated in the list.
- Poster: episode image wins; feed image is the fallback; a `media:thumbnail` may supply a
  landscape poster when the feed provides one. The existing art cache serves it.
- Video `width`/`height` come from `media:content` when present.
- Duration stays the parser's iTunes/media duration, then the engine's reported duration
  after first play.
- No duration-based classification. `media_form` is declared by the feed.

### 5.8 Downloads, compression and offline

- **RSS video episodes only.** Video pins are a user action, never automatic. The UI shows
  the estimated size before pinning and warns when the file is large (`> 500 MB` or `> 10%`
  of free space, whichever the quota policy reports).
- Download choices:
  - **Original** — the publisher's enclosure, untouched.
  - **Audio only** — when the feed provides an audio alternate, use it; otherwise extract
    the audio track into an M4A/AAC copy.
  - **Compressed video** — 720p or 480p H.264/AAC copies for space saving. Presets are
    fixed; no arbitrary ffmpeg arguments.
- The existing `.part` → hash → rename, quota, Wi-Fi policy, progress events and eviction
  protection are reused. Downloads gain a **Compressing** phase before verification;
  a failed compression keeps the original download when possible and reports the failure.
- `DownloadView` gains `mediaForm`, `variant` and optional output dimensions, derived from
  the download record/metadata. No schema change is required beyond the existing
  profile/container fields; if the chosen preset cannot be represented, add a small
  `download.variant` column with a migration in S060.
- A pinned video plays offline with the video surface. Removing a source asks whether to
  delete its pins, as MVP-5 does for feeds.
- A failed pin leaves no partial row. A missing/corrupt pin is reported as unverified, not
  silently played.
- Android needs parity for direct podcast enclosure downloads; iOS already routes podcast
  enclosures through its remote download path. Confirm and fix in S059.

**Compression presets**

| Preset | Output | Target | Use |
| --- | --- | --- | --- |
| Audio only | M4A/AAC, mono 64 kbps or stereo 96 kbps | Smallest spoken-word copy | Commute/background listening |
| 480p | MP4/H.264 + AAC, ~800 kbps | Phone-sized video | Small-screen offline |
| 720p | MP4/H.264 + AAC, ~1.5 Mbps | Tablet/laptop video | Moderate quality |
| Original | Publisher enclosure | No quality loss | Maximum fidelity |

- Android: Media3 `Transformer` with audio-only and video encoder settings.
- iOS: `AVAssetExportSession` (`AppleM4A` for audio, 480p/720p presets for video).
- Desktop: requires a user-provided/system `ffmpeg` in v1; if it is unavailable, the
  compressed options are disabled with a clear explanation, while original and, when the
  feed provides one, audio-alternate downloads still work. Bundling ffmpeg is a later
  licensing/packaging decision, not part of S054–S061.
- Compression is CPU/disk heavy; run it in the existing background download queue, never on
  the playback thread, and expose progress/cancel.

### 5.9 UI

**Podcasts home / show detail**

- A video badge and duration on video episodes; filters gain **Video**. Video-only
  episodes stay in the normal list and queue; the filter narrows the view, it does not hide
  them permanently.
- Show-level preference: audio default / video default; refresh, remove. The default is
  audio; a feed/tier that only exposes video uses video.
- A video episode row shows its poster/thumbnail and a play badge; opening show notes does
  not start playback.

**Now Playing**

- Video stage: poster until playback, then the video surface (desktop embedded; mobile
  full-screen button). Controls: Play video / Audio only, Picture-in-Picture, Fullscreen,
  Download (with size and compression choices), speed, skip, queue.
- Audio-only mode shows the existing artwork stage, not a black rectangle. A video-only
  episode still plays audio from its video container when the codec is supported.
- If a video surface cannot be created or decoded, the audio path continues and a clear
  `UNSUPPORTED_MEDIA`/`VIDEO_UNAVAILABLE` message explains why.

**Mini player**

- Poster/thumbnail and a small video icon when video is available. Tapping opens Now
  Playing. The mini player never creates a second video element.

**Settings**

- Video: `auto` (show video when the episode has it), `audio-only` (always detach), or
  `ask`.
- Data saver: prefer audio-only on metered connections.
- Downloads: size warnings and quota display.

**Accessibility**

- Every video control has an accessible name and keyboard path. PiP/fullscreen buttons are
  buttons, not icon-only divs. Focus returns to the play control when PiP closes.
- Reduced motion applies to the video stage transitions. Captions/subtitles are not in
  scope; do not claim them.

### 5.10 Platform plan

**Electron desktop**

- Renderer: `<video>`/`<audio>` media manager, PiP, fullscreen, poster, audio-only.
- Main: migration 7, protocol video MIME, `powerSaveBlocker`, background-throttling policy,
  media-session metadata.
- Packaging: no extractor is added. Video compression uses a user-provided/system
  `ffmpeg` in v1; if it is unavailable, original/audio-alternate downloads still work.
  Bundling ffmpeg is a later licensing/packaging decision. electron-builder outputs are
  otherwise unchanged except for the app code.

**Android**

- Room v8 and shared parser via the existing native adapter.
- Media3 `PlayerView`/surface: full-screen video and PiP; detach on background.
- Media3 `Transformer` for audio-only and 480p/720p download compression.
- Foreground media service and notification continue to own playback. No second player.
- Car browse remains audio-only; a video-only episode is offered only when its audio track
  is decodable, otherwise it is shown as unavailable rather than broken.

**iOS**

- SQLite v7 and shared parser.
- AVPlayerLayer full-screen video and `AVPictureInPictureController`; background audio
  unchanged.
- `AVAssetExportSession` for audio-only and 480p/720p download compression.
- CarPlay remains audio-only and uses the existing podcast rows.
- No external-video-platform source or extractor is present.

### 5.11 Security, privacy and legal

- All enclosures, alternates, posters and download URLs pass the existing HTTP(S)/SSRF gate
  and redirect revalidation. No `file:`, `data:`, `blob:` or platform-pseudo URLs.
- Feed HTML is still converted to plain text plus a bounded safe-link list. No raw HTML,
  embedded players, tracking pixels or hotlinked artwork by default.
- Media URLs may contain signed tokens. Log the episode id and host hash, never the full
  URL.
- Video is the publisher's content. Statocyst streams/pins the advertised enclosure for the
  user's personal playback; it does not re-host, redistribute or publish it.
- No analytics, no third-party embeds, no credential changes.
- A packaging audit asserts no yt-dlp/ffmpeg/Python/NewPipe artifact appears in any core
  build. This is a guard against later scope creep, not a feature.

### 5.12 Performance budgets

- Video surface hidden/backgrounded: no continuous video decode; audio CPU and battery are
  within the MVP-5 podcast baseline on the named reference device. Measure screen-off
  60-minute playback on Android and iOS.
- PiP: no more than one decoded video surface. No second player, no duplicate media session.
- Desktop: 1080p RSS video plays without frame drops on the reference machine; 4K is not a
  gate. The audio path must not regress when video is disabled.
- Startup: no change; video metadata is part of the normal feed refresh.
- Downloads: video pins respect quota; the size estimate is shown before download; a failed
  pin leaves no partial row.
- Compression: a 1-hour 720p pass completes within a bounded background window on the named
  reference device without blocking playback; cancellation leaves no corrupt final file;
  CPU/thermal behavior is recorded.
- Feed lists: bounded alternates, paged episode queries (existing 50) and windowed rendering.
- Memory: an hour-long 1080p video pin is a file on disk, not an in-memory buffer.

## 6. Migration and compatibility

- Desktop migration 7 is additive; the pre-migration `VACUUM INTO` backup still runs. A
  migration test starts from a real v6 database with music, podcasts, queue, downloads and
  cache rows and asserts unchanged music/podcast behavior.
- Android v7 → v8 and iOS 6 → 7 are additive and idempotent. Old rows read as audio.
- Older hosts without `mediaForm` keep working: the renderer hides video controls.
  `Track.mediaForm` is optional on the wire.
- No existing music or podcast queue, download or play-history row is rewritten.
- A downgrade is not supported; the existing backup/restore guidance applies.

## 7. Testing and evidence

| Layer | Required |
| --- | --- |
| Parser | Video-only, audio+video, `media:content`, multiple enclosures, bad MIME, oversized alternate list, relative URLs, SSRF |
| Contracts | Optional `mediaForm` on old payloads; `setPresentation`; schema fixtures for video and alternates |
| Repository | Migration 7 from real v6 data; alternates serialization; no orphan media items; form consistency |
| Protocol | Video MIME, Range/HEAD for a video enclosure; 401/403/404 mapping; download precedence |
| Desktop E2E | Video RSS episode: play, video visible, audio-only toggle, minimize, media key, PiP/fullscreen where available, restart/resume |
| Android | Room v8 migration; full-screen video; surface detach; screen-off audio; PiP; media session |
| iOS | SQLite v7 migration; AVPlayerLayer; PiP; screen-off audio |
| Car | Audio-only browse/play; video-only episode handling; no video template |
| Downloads | Pin video/audio, size/quota, offline playback, remove, corrupt file |
| Compression | Audio-only, 480p, 720p; size/quality check; cancel/failure fallback; desktop no-ffmpeg state; playback of compressed output |
| Security | SSRF on enclosures/alternates/posters; URL redaction; no-extraction artifact audit |
| Performance | Screen-off 60-minute audio; hidden video decode; 1080p playback; large pin/quota; compression time/CPU; startup |
| Accessibility | Control names, keyboard path, focus return from PiP, reduced motion |

Evidence reports S054–S061 follow `evidence/TEMPLATE.md`, with command, exit code,
environment, logs and artifacts. Unit tests alone do not make a platform gate VERIFIED.

## 8. Slice map

| Slice | Scope | Depends on |
| --- | --- | --- |
| S054 | Contracts, migration 7, Room v8, iOS v7, episode mapping for media form and alternates | MVP-5 S042 |
| S055 | Video enclosure parsing and primary/alternate selection, poster/size metadata | S054 |
| S056 | Desktop video presentation: `<video>`, PiP, fullscreen, audio-only, background/media session | S054, S055 |
| S057 | Android video presentation: PlayerView, PiP, surface detach, screen-off audio | S054, S055 |
| S058 | iOS video presentation: AVPlayerLayer, PiP, screen-off audio | S054, S055 |
| S059 | Video downloads/offline: size/quota, audio-only alternate, cleanup, Android parity | S055–S058 |
| S060 | Download compression: audio-only, 480p/720p, native/desktop adapters, failure/cancel | S059 |
| S061 | Cross-platform verification, performance, security, accessibility, release gate | S056–S060 |

## 9. Release gate (MVP-6)

All of the following are required before MVP-6 is called VERIFIED:

1. A video RSS podcast plays on desktop, Android and iOS; video is visible when requested,
   audio-only works, background/screen-off audio continues, and restart resumes correctly.
2. Music, audio podcasts, queues, radio, playlists, favorites, stats, downloads and cache
   show no regression. The one-authoritative-queue invariant still holds.
3. Audio/video alternate selection works: an episode with both forms starts audio by
   default, can switch to video without losing position, and the feed preference is
   respected.
4. Video pin shows size, respects quota, plays offline, and removes cleanly. Audio-only pins
   are offered where the feed provides an audio alternate. Compression presets produce a
   smaller, playable file; cancellation/failure leaves no corrupt final file; desktop
   without ffmpeg disables compression clearly.
5. Android and iOS screen-off/background audio is demonstrated on named runtimes; desktop
   minimize/media-key behavior is demonstrated in E2E. PiP is demonstrated or recorded as
   BLOCKED with a reproduction recipe.
6. Car surfaces remain audio-only; a video-only episode has a clear state rather than a
   broken player.
7. Security checks pass: SSRF on enclosures/alternates/posters, media-URL redaction, no
   extraction artifact and no bundled ffmpeg in core/default artifacts.
8. Performance gates pass on named references: hidden-video CPU/battery, 1080p playback,
   large-file download and startup.
9. Accessibility checks pass for video controls and PiP focus.
10. Evidence S054–S061 is complete. Runtime-only gates that remain open are called out as
    BLOCKED; they are not reported as passing.

## 10. Risks and open questions

| Risk | Mitigation / decision |
| --- | --- |
| Video files are much larger than audio | Size estimate, quota, opt-in pins, audio-only alternate where published |
| Users expect YouTube | Explicit non-goal in help/release notes; no YouTube entry point; RSS video is the supported path |
| A feed advertises video but the content is audio | Trust MIME first, verify content type on first play, allow a manual form override |
| Hidden `<video>` still decodes | Measure CPU/battery; detach/switch to audio alternate; no background video promise |
| Two surfaces / duplicate audio | One engine and one active surface invariant; tests for PiP + background, mini player + full screen |
| Mobile embedded video complexity | v1 uses native full-screen + PiP; no WebView video surface |
| Range/redirect behavior differs by host | Reuse the verified protocol proxy and add video fixtures; clear errors on 401/403/404 |
| Codec not supported by a platform | Report `UNSUPPORTED_MEDIA`; keep audio if the container's audio track is decodable; offer compression where available |
| Video download on Android lags iOS | S059 explicitly verifies direct-enclosure download parity |
| Compression is slow or heats the device | Background queue, fixed presets, progress/cancel, measured time/CPU; original download remains available |
| Desktop has no ffmpeg | Compression options disabled with a clear explanation; original and audio-alternate downloads still work; bundling is a later licensing decision |
| Compression quality is poor for some content | Presets are labelled as space-saving; original remains the default fidelity choice; no automatic conversion |
| Accessibility gaps in video controls | Named controls, keyboard path, focus return, reduced motion gate |
| Scope creep back to YouTube | ADR-037 records the exclusion; a reversal needs a new ADR with legal/platform costs |

## 11. Decisions recorded (2026-11-11)

1. **Audio is the default** when both forms exist. The feed/subscription tier determines
   what is actually available; Statocyst uses the subscribed feed and never guesses or
   fetches a different tier. The user can switch to video at any time. MVP-6 does not add
   premium/member-feed authentication or a feed-URL importer.
2. **Video pins are a user action**, never automatic. The pin sheet offers original,
   audio-only and compressed video choices; compression is a fixed spoken-word/space-saving
   preset, not a general transcoder.
3. **Mobile v1 is full-screen + PiP.** No embedded WebView video surface in MVP-6.
4. **Video-only episodes are included** in the normal list and queue, with a **Video**
   filter. They remain playable in audio-only mode when the platform can decode the audio
   track; unsupported codecs report an error instead of hiding the episode.
