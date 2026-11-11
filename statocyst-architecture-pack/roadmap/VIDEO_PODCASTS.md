# MVP-6 — Video podcasts and optional YouTube sources

**Status:** PLANNED (2026-11-11). Design intent only; no implementation is asserted.
**Decision record:** ADR-037.
**Slice range:** S054–S062.
**Depends on:** MVP-5 podcast gate (`roadmap/PODCASTS.md` §18). S054 may start earlier,
but no MVP-6 release claim may precede a passing MVP-5 gate or an explicit product decision
to re-scope.

## 1. Objective

Extend the podcast experience without weakening the music player or the MVP-5 podcast
contract:

- Play **video podcast episodes** published by RSS/Atom feeds, with a real video surface on
  desktop and full-screen/PiP video on mobile.
- Keep **audio authoritative**: video is a presentation layer. Audio continues when the
  window is minimized, the app is backgrounded, the screen is locked, or the user chooses
  audio-only.
- Let a user add **podcast-length YouTube videos** (default ≥ 20 minutes; a "podcast
  length" preset uses 45 minutes) as podcast episodes, so they can listen in the
  background without the YouTube app or YouTube Premium.
- Keep the core app free of YouTube extraction code. YouTube resolution is supplied by an
  optional, separately installed, user-run **Statocyst Companion**.
- Be explicit about the trade-off: extracting YouTube streams is against YouTube's terms,
  may break, and is not available on iOS. The compliant RSS video path is the default.

## 2. Non-goals

- A general video library, video playlists for music videos, or a YouTube replacement UI.
- Downloading, re-hosting, redistributing or publishing YouTube content, or running a
  public proxy/aggregate feed.
- Stripping, blocking or replacing YouTube ads; bypassing paywalls, DRM, age gates or
  regional restrictions.
- Bundling yt-dlp/ffmpeg/Python/NewPipe Extractor in the core desktop app, Android core
  module, iOS app or store builds.
- YouTube extraction on iOS. iOS ships RSS video podcasts only.
- Embedded video inside the mobile WebView in v1. Android/iOS use a native full-screen
  video surface and native PiP; an embedded surface is a later refinement.
- Live streams, premieres, Shorts, YouTube Music, chapters/transcripts, comments or
  recommendations.
- Cross-device video resume, casting, AirPlay/Chromecast, or background video decoding
  while the screen is off (audio-only is the expected state there).
- Automatic conversion of every YouTube video into a podcast, or a YouTube
  discovery/recommendation feed. The user explicitly adds a channel, playlist or video;
  classification is bounded, explainable and user-overridable.
- YouTube on an Android device with no paired companion. There is no on-device extractor
  in the core APK; a companion (or a later separate plugin) is required.

## 3. Baseline and what changes

| Concern | MVP-5 baseline | MVP-6 change |
| --- | --- | --- |
| Media identity | `media_kind='podcast'`; one enclosure | `media_form` (`audio`/`video`) plus alternate enclosures |
| Feed parser | First valid enclosure wins | Collect all valid enclosures; choose a primary and retain alternates |
| Playback engine | One `<audio>` element; Media3/AVPlayer audio | Media element may be `<video>`; native video surfaces; audio remains authoritative |
| Contract | `Track`, `EngineLoadRequest` audio-only | `mediaForm`, poster, presentation mode, video metadata |
| Protocol | Podcast remote URL proxy | Same proxy for RSS video; new `youtube` remote kind through the companion |
| Downloads | Audio episode pins | RSS video pins (large, opt-in); YouTube remains streaming-only |
| Discovery | Apple/Fyyd; no user feed URLs | Adds an explicit "Add video podcast" flow for YouTube, gated on a paired companion |
| Platforms | Desktop, Android, iOS, Auto, CarPlay audio | Desktop embeds video; Android/iOS full-screen + PiP; car remains audio-only |
| Legal posture | Publisher RSS only | Optional unofficial YouTube path, off by default, with a clear notice |

## 4. YouTube options considered

| Option | Background play | Cross-platform | Terms / licence | Maintenance | Verdict |
| --- | --- | --- | --- | --- | --- |
| Official Data API + IFrame player | No; explicitly prohibited by API policy | All webviews | Compliant | Low | Rejected: does not meet the goal |
| YouTube RSS metadata only + "open in YouTube" | No | All | Compliant | Low | Keep as fallback/deep link |
| yt-dlp inside core desktop process | Yes | Desktop only | Against YouTube ToS; binary is Unlicense but extraction is the issue | High | Rejected as core |
| NewPipe Extractor inside Android app | Yes | Android | Against ToS; GPLv3 linking changes the app's licence | High | Rejected as core; possible separate plugin later |
| Local companion bridge (yt-dlp in a separate process) | Yes | Desktop; Android via LAN | User-run, opt-in; still against YouTube ToS | Medium; isolated | **Recommended** |
| Project-hosted proxy / re-hosting service | Yes | All | Redistribution and ToS violation; operating liability | Very high | Rejected |
| Podcast's own RSS/video feed | Yes | All | Compliant | Low | **Default path** |

The companion is the only option that meets the user goal without putting a GPL extractor,
a Python runtime or an App Store liability into the core product. It does not make the
feature compliant; it makes the risk explicit, separable and user-owned.

## 5. Architecture

### 5.1 Media model

Video is a **presentation of a podcast episode**. The existing `media_kind = 'podcast'`
stays; music queries and the one-authoritative-queue invariant are untouched.

```
podcast_feed (source_kind = rss | youtube-channel | youtube-playlist | youtube-video | bridge)
  └── podcast_episode (media_form = audio | video, alternates_json, external_id)
        └── media_item (media_kind = podcast, media_form = audio | video, path)
              └── podcast_queue_entry / download / cache
```

An episode can advertise both forms. `media_form` is the **primary** presentation;
`alternates` carries the rest. The UI shows a video badge when any form is video. For a
YouTube episode the primary is audio by default (smaller, background-friendly), with video
available on demand through the companion; it is not represented as an alternate enclosure
because the companion resolves both forms by video id.

### 5.2 Desktop schema — migration 7

Additive only. No table rebuild, no media-kind CHECK change, no queue rewrite.

```sql
ALTER TABLE media_item ADD COLUMN media_form TEXT NOT NULL DEFAULT 'audio'
  CHECK (media_form IN ('audio', 'video'));

ALTER TABLE podcast_feed ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'rss'
  CHECK (source_kind IN ('rss', 'youtube-channel', 'youtube-playlist', 'youtube-video', 'bridge'));
ALTER TABLE podcast_feed ADD COLUMN external_id TEXT;
ALTER TABLE podcast_feed ADD COLUMN bridge_id TEXT;
ALTER TABLE podcast_feed ADD COLUMN default_media_form TEXT NOT NULL DEFAULT 'audio'
  CHECK (default_media_form IN ('audio', 'video'));
-- 0 disables duration classification for an explicitly added channel.
ALTER TABLE podcast_feed ADD COLUMN min_duration_minutes INTEGER NOT NULL DEFAULT 20;
ALTER TABLE podcast_feed ADD COLUMN include_shorts INTEGER NOT NULL DEFAULT 0
  CHECK (include_shorts IN (0, 1));

ALTER TABLE podcast_episode ADD COLUMN media_form TEXT NOT NULL DEFAULT 'audio'
  CHECK (media_form IN ('audio', 'video'));
ALTER TABLE podcast_episode ADD COLUMN alternates_json TEXT;
ALTER TABLE podcast_episode ADD COLUMN external_id TEXT;
ALTER TABLE podcast_episode ADD COLUMN source_page_url TEXT;
ALTER TABLE podcast_episode ADD COLUMN poster_url TEXT;
ALTER TABLE podcast_episode ADD COLUMN video_width INTEGER;
ALTER TABLE podcast_episode ADD COLUMN video_height INTEGER;
ALTER TABLE podcast_episode ADD COLUMN classification TEXT NOT NULL DEFAULT 'declared'
  CHECK (classification IN ('declared', 'inferred', 'manual'));
ALTER TABLE podcast_episode ADD COLUMN classification_reason TEXT;
ALTER TABLE podcast_episode ADD COLUMN stream_kind TEXT NOT NULL DEFAULT 'direct'
  CHECK (stream_kind IN ('direct', 'resolved', 'hls'));

CREATE INDEX idx_podcast_episode_form ON podcast_episode(media_form);
```

Notes:

- `stream_kind = 'resolved'` means the host must resolve a fresh URL at play time
  (YouTube); `direct` is a normal enclosure; `hls` is reserved but not accepted by the
  MVP-6 playback gate until every target can consume it. The companion must expose
  progressive audio/video for v1.
- Resolved URLs expire and may contain credentials. They are cached **in memory only**,
  keyed by episode/form, with a TTL bounded by the companion's expiry. They are never
  written to the catalog or logs.
- RSS video downloads reuse the existing `download` table; `media_form` is derived from the
  joined media item. YouTube sources do not create download rows. No download schema
  change is needed.

### 5.3 Mobile schemas

- **Android:** Room v7 → v8. Add `mediaForm` to `MediaItemEntity`; add
  `sourceKind`, `externalId`, `bridgeId`, `defaultMediaForm`, `minDurationMinutes`,
  `includeShorts` to `PodcastFeedEntity`; add `mediaForm`, `alternatesJson`, `externalId`,
  `sourcePageUrl`, `posterUrl`, `videoWidth`, `videoHeight`, `classification`,
  `classificationReason`, `streamKind` to `PodcastEpisodeEntity`. Add the form index.
- **iOS:** `StatocystDatabase.SCHEMA_VERSION` 6 → 7 with idempotent `ALTER TABLE` guarded
  by the version. Same columns and defaults.
- Both migrations are additive; existing music rows read as `mediaForm = 'audio'`.
- The MVP-5 tests for screen-off audio, process death and queue restore are extended, not
  replaced.

### 5.4 Contracts

```ts
export type MediaForm = 'audio' | 'video';
export type PodcastSourceKind =
  | 'rss'
  | 'youtube-channel'
  | 'youtube-playlist'
  | 'youtube-video'
  | 'bridge';
export type PodcastClassification = 'declared' | 'inferred' | 'manual';

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
//   externalId?: string | null;

// PodcastEpisode gains:
//   mediaForm: MediaForm;
//   alternates: PodcastEnclosure[];
//   externalId: string | null;
//   sourcePageUrl: string | null;
//   posterUrl: string | null;
//   videoWidth: number | null;
//   videoHeight: number | null;
//   classification: PodcastClassification;
//   classificationReason: string | null;
//   streamKind: 'direct' | 'resolved' | 'hls';

// PodcastFeed gains:
//   sourceKind: PodcastSourceKind;
//   externalId: string | null;
//   bridgeId: string | null;
//   defaultMediaForm: MediaForm;
//   minDurationMinutes: number;
//   includeShorts: boolean;
```

Playback contract additions:

```ts
export type Presentation = 'audio-only' | 'video';

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

Companion bridge surface (exposed only when the host supports it):

```ts
export interface CompanionStatus {
  configured: boolean;
  paired: boolean;
  version: string | null;
  capabilities: Array<'youtube' | 'progressive-media'>;
  lastError: string | null;
}

export interface VideoSourceProbe {
  kind: 'channel' | 'playlist' | 'video';
  externalId: string;
  title: string;
  author: string | null;
  artworkUrl: string | null;
  itemCount: number;
  eligibleCount: number;
  sample: Array<{
    externalId: string;
    title: string;
    durationMs: number;
    publishedAt: string | null;
    live: boolean;
  }>;
  classificationNote: string;
}

export interface CompanionBridge {
  status(): Promise<CompanionStatus>;
  pair(code: string): Promise<Result<CompanionStatus>>;
  unpair(): Promise<void>;
  probe(url: string): Promise<Result<VideoSourceProbe>>;
  addSource(url: string, options?: {
    minDurationMinutes?: number;
    includeShorts?: boolean;
  }): Promise<Result<PodcastFeed>>;
}
```

`CompanionBridge` is additive on `StatocystBridge`; older hosts simply do not expose it
and the renderer hides the YouTube source entry point.

### 5.5 Protocol and engine

- The protocol proxy keeps `statocyst-media://track/<id>` and Range/HEAD support. Video MIME
  types are added to the served-type allowlist; the upstream `Content-Type` is still
  passed through.
- `RemoteTrack` gains a YouTube variant:

```ts
export interface YoutubeRemoteTrack {
  kind: 'youtube';
  episodeId: string;
  externalId: string;
  form: MediaForm;
}
```

- `ProtocolOptions` gains a resolver:

```ts
resolveCompanionStream?: (input: {
  episodeId: string;
  externalId: string;
  form: MediaForm;
}) => Promise<{ url: string; contentType: string | null; expiresAt: string | null } | null>;
```

- The resolver runs in the host, not the renderer, and only for episodes that belong to a
  paired YouTube source. It calls the companion's `/v1/media/...` endpoint with the
  pairing token. The protocol proxy forwards Range and revalidates the companion URL per
  play. No arbitrary feed-supplied URL is ever sent to the companion.
- Desktop: the renderer owns a `<video>` element for video tracks and keeps the existing
  `<audio>` element for audio tracks. Only one is active at a time. The video element has
  `playsinline`, a poster, and no `disablePictureInPicture`.
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
| Minimized/background | Audio continues; video hidden; optional PiP | Audio continues; surface detached; PiP if user leaves video | Audio continues; layer detached; PiP |
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
- Background CPU: no video frames are decoded when the surface is hidden (the element may
  remain attached but paused video tracks are not rendered). Measure battery/CPU on the
  reference machine; if hiding is insufficient, reload audio-only for video-only sources.
  This is an explicit performance gate.

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
- Classify form from `type` first, then `medium`, then a conservative extension/URL hint.
  `application/octet-stream` is not assumed to be video.
- Primary selection:
  1. If the feed has both audio and video, prefer **audio** as the primary for background
     listening and keep video as an alternate.
  2. If only video exists, primary is video.
  3. If the user's feed preference is `defaultMediaForm='video'`, prefer video.
- Validate every enclosure URL with the existing HTTP(S)/SSRF gate. Reject non-HTTP(S);
  a `youtube://` pseudo-URL is only valid for a `source_kind` that the host owns, never
  from an RSS feed.
- `alternates_json` is bounded (max 8), sanitized, and persisted in the same transaction as
  the episode. Duplicate URLs collapse; the primary is not duplicated in the list.
- Poster: episode image wins; feed image is the fallback; the existing art cache serves it.
  Video `width`/`height` come from `media:content` when present.
- Duration stays the parser's iTunes/media duration, then the engine's reported duration
  after first play.

### 5.8 YouTube ingestion

#### Source discovery

The user adds one of:

- a channel URL (`https://www.youtube.com/@handle`, `/channel/<id>`, `/c/<name>`),
- a playlist URL (`/playlist?list=<id>`),
- a single video URL (`/watch?v=<id>`, `youtu.be/<id>`).

The companion normalizes it to a `kind` and `externalId`, then returns a probe with title,
author, item count, duration distribution and the number of items that pass the current
classification rule. The app shows the probe before writing anything.

The channel case uses the public channel RSS feed
(`https://www.youtube.com/feeds/videos.xml?channel_id=<id>`) for the newest items and the
companion for duration/backfill. Channel RSS has no duration, so it cannot classify on its
own. Playlists and single videos always go through the companion. No scraping of the
YouTube HTML pages by Statocyst.

#### Classification

Rules are ordered and stored with a human-readable reason:

1. **Declared**: the episode came from an RSS video enclosure (`media_form=video`).
2. **Manual**: the user marked the episode or channel "treat as podcast".
3. **Inferred**: a YouTube item is eligible when:
   - `durationMs >= minDurationMinutes * 60_000` (default 20; "podcast length" preset 45;
     `0` disables the filter for an explicitly added channel),
   - not a Short (default reject `< 5 min` unless `includeShorts`),
   - not live, upcoming, a premiere or a stream VOD,
   - the item is a normal public video.
   Title/description keywords ("podcast", "episode", "interview", "conversation", "show")
   may raise a suggestion but never override the duration rule automatically.
4. **Excluded**: everything else stays out of the podcast library. The source can still be
   viewed in the companion; Statocyst does not import it.

The UI always shows the reason, e.g. `Video · 1h 12m · podcast-length` or
`Music video · 3m · excluded`. A per-episode "Not a podcast" action sets
`classification='manual'` and removes it from the queue without deleting the source.

#### Episode mapping

| Field | YouTube value |
| --- | --- |
| `podcast_feed.feed_url` | canonical channel RSS URL, playlist URL or watch URL; adapter-specific |
| `podcast_feed.source_kind` | `youtube-channel` / `youtube-playlist` / `youtube-video` |
| `podcast_feed.external_id` | channel/playlist/video id |
| `podcast_episode.external_id` | YouTube video id |
| `podcast_episode.enclosure_url` | stable `youtube://video/<id>` pseudo-URL (never fetched directly) |
| `podcast_episode.source_page_url` | `https://www.youtube.com/watch?v=<id>` |
| `podcast_episode.stream_kind` | `resolved` |
| `podcast_episode.media_form` | `audio` by default; `video` when the user chooses video |
| `podcast_episode.poster_url` | cached thumbnail |
| `media_item.path` | `youtube://video/<id>`; `refreshMissing` skips it |
| `media_item.ext` | `m4a` for audio, `mp4` for video (presentation hint, not a download guarantee) |
| `media_item.size_bytes` | 0 unless the companion reports an estimate |

`path_key` stays deterministic: `youtube:<videoId>` or the existing hash scheme with the
pseudo-URL. Re-importing the same channel is idempotent.

#### Refresh

- Channel RSS is polled on the existing feed schedule (minimum 15 minutes, default 60) and
  creates new episode rows with `classification='inferred'` pending duration.
- The companion fills duration and backfills older items on demand (bounded by 100 per
  source initially, 2,000 total per feed as MVP-5).
- A failed companion does not delete episodes or queue entries; it sets a feed-level
  `fetch_error` and marks unresolved episodes as companion-unavailable at play time.
- No auto-download. No background refresh while a mobile app is suspended; the existing
  foreground/manual policy applies.
- The companion is the only component that talks to YouTube. Statocyst never sends the
  user's cookies or pairing token to YouTube.

### 5.9 Companion contract

A separate program (separate repository or separately distributed binary) with a versioned
HTTP API. Statocyst treats it as an untrusted local service: authenticated, bounded,
time-limited and not able to make Statocyst fetch arbitrary URLs.

```
GET  /v1/health                         -> { version, capabilities, paired }
POST /v1/pair       { code, client }    -> { token, bridgeId, version }
POST /v1/probe      { url }             -> VideoSourceProbe
POST /v1/list       { sourceId, cursor } -> { items, nextCursor }
GET  /v1/media/{episodeId}?form=audio   -> 200/206 bytes, Range supported
GET  /v1/art/{sourceId}                 -> image bytes (optional)
```

- `Authorization: Bearer <token>` on every endpoint except `/v1/health`; `/v1/health`
  returns no titles, URLs or account information.
- Pairing code is short-lived, single-use, displayed by the companion, and exchanged for a
  token stored by Statocyst in `safeStorage` (desktop) or Keychain (iOS/Android).
- Bind `127.0.0.1` by default. LAN mode is explicit and requires the token; plain HTTP over
  a LAN is discouraged. Tailscale/WireGuard or HTTPS is recommended for remote use.
- `/v1/media` streams progressive audio (M4A/AAC or Opus-in-WebM) and, when requested,
  progressive MP4 video. It supports `Range`, `HEAD`, 206 responses and a hard timeout.
  HLS is not accepted by the v1 playback gate.
- The companion enforces its own concurrency limits and YouTube backoff. Statocyst
  global/per-host limits do not apply to the companion's outbound calls, but the app
  serializes probe/list/media requests per source.
- Error mapping: unreachable → `MEDIA_UNAVAILABLE`; unpaired → `UNAUTHORIZED`; unsupported
  video → `UNSUPPORTED_MEDIA`; companion rate-limited → retryable `MEDIA_UNAVAILABLE` with
  a user-facing wait; never leak a raw extractor error or media URL.
- The app refuses a bridge with a different major version, and shows the companion version
  in diagnostics without exposing its path or cookies.

### 5.10 Downloads and offline

- **RSS video episodes only.** Video pins are opt-in. The UI shows the estimated size
  before pinning and warns when the file is large (`> 500 MB` or `> 10%` of free space,
  whichever the quota policy reports).
- When the feed provides a separate audio enclosure, the download sheet offers **Audio
  only** (recommended) or **Video**. Video-only episodes download the whole file.
- **YouTube episodes are streaming-only.** The pin/download action is hidden for
  `source_kind` YouTube. This avoids adding persistent copying to the extraction risk. A
  YouTube episode offline shows "Companion or network required — YouTube sources are
  streaming-only", not a silent skip.
- The existing `.part` → hash → rename, quota, Wi-Fi policy, progress events and eviction
  protection are reused. `DownloadView` gains `mediaForm` and `presentationHint` derived
  from the joined media item; no table change is required.
- A pinned RSS video plays offline with the video surface. Removing a source asks whether
  to delete its pins, as MVP-5 does for feeds.

### 5.11 UI

**Podcasts home / show detail**

- A video badge and duration on video episodes; filters gain **Video**.
- Show-level toggle: media preference (audio default / video default), classification
  minimum, include Shorts (off by default), refresh, remove.
- "Add video podcast" is a separate entry point from Discovery. It only appears when the
  companion is configured; otherwise it opens a setup panel with the legal notice and a
  link to the companion, not a raw URL form for arbitrary RSS.

**Now Playing**

- Video stage: poster until playback, then the video surface (desktop embedded; mobile
  full-screen button). Controls: Play video / Audio only, Picture-in-Picture, Fullscreen,
  Download (with size; RSS video only), speed, skip, queue.
- The stage always shows the show title, episode title, duration and classification reason
  when the episode is inferred. It never hides the fact that a YouTube item is unofficial.
- Audio-only mode shows the existing artwork stage, not a black rectangle.

**Mini player**

- Poster/thumbnail and a small video icon when video is available. Tapping opens Now
  Playing. The mini player never creates a second video element.

**Settings**

- Video: `auto` (show video when the episode has it), `audio-only` (always detach), or
  `ask`.
- Data saver: prefer audio-only on metered connections.
- Companion: status, version, pair/unpair, LAN address, "test connection", legal notice,
  and a diagnostics line that redacts the token.
- YouTube source: enable/disable, default minimum duration, include Shorts, and a clear
  "experimental / may violate YouTube terms" label.

**Accessibility**

- Every video control has an accessible name and keyboard path. PiP/fullscreen buttons are
  buttons, not icon-only divs. Focus returns to the play control when PiP closes.
- Reduced motion applies to the video stage transitions. Captions/subtitles are not in
  scope; do not claim them.

### 5.12 Platform plan

**Electron desktop**

- Renderer: `<video>`/`<audio>` media manager, PiP, fullscreen, poster, audio-only.
- Main: migration 7, protocol video MIME and YouTube resolver, companion client with
  `safeStorage`, `powerSaveBlocker`, background-throttling policy, media-session metadata.
- Packaging: no extraction dependency in `app.asar`. The companion is not bundled by
  default. electron-builder config gains no yt-dlp/ffmpeg extraResources for MVP-6.

**Android**

- Room v8 and shared parser via the existing native adapter.
- Media3 `PlayerView`/surface: full-screen video and PiP; detach on background.
- Companion over authenticated LAN; pairing via QR/code. No extraction in the APK.
- Optional separate plugin APK (GPL-compatible, separately distributed) is a later
  decision, not part of S054–S062.
- Car browse includes audio-eligible YouTube episodes only when the companion is reachable
  and a stream can be resolved; otherwise the section is hidden, not broken. YouTube
  episodes are never downloadable, so a car session always needs the companion or network.

**iOS**

- SQLite v7 and shared parser.
- AVPlayerLayer full-screen video and `AVPictureInPictureController`; background audio
  unchanged.
- **No YouTube source.** The companion entry point is absent from the iOS build. RSS video
  podcasts are supported. App Store copy must not imply YouTube support.
- CarPlay remains audio-only and uses the existing podcast rows.

### 5.13 Security, privacy and legal

- The companion is an explicit trust boundary. The app validates its version, requires a
  token, limits response size/time, and never follows redirects to non-configured hosts.
- The pairing token and cookies never enter the catalog, renderer `localStorage`, logs or
  support bundles. A support-bundle test asserts redaction.
- Media URLs (which can be signed/expiring) are never logged. Log episode id and host hash.
- Feed-supplied URLs are still validated by the existing SSRF guard. The companion endpoint
  is not a generic proxy: only the host, not feed content, chooses what to resolve.
- The legal notice is shown before the first YouTube source is added and is repeated in
  Settings. Suggested copy:

  > Statocyst's YouTube source is unofficial and experimental. It uses a separately
  > installed companion to access streams and may violate YouTube's Terms of Service. It may
  > stop working at any time. Use it only for content you have the right to access. Statocyst
  > does not host, redistribute or re-publish YouTube content.

- No feature may be described as "compliant background play" or "official YouTube support".
  The RSS video path is the compliant path and is described separately.
- The project does not ship the companion in app stores, does not publish a public proxy,
  and does not accept cookies or credentials on behalf of users.
- A release checklist item requires a legal/UX review of the notice and store copy before
  the YouTube source is enabled in a distributed build.

### 5.14 Performance budgets

- Video surface hidden/backgrounded: no continuous video decode; audio CPU and battery are
  within the MVP-5 podcast baseline on the named reference device. Measure screen-off
  60-minute playback on Android and iOS.
- PiP: no more than one decoded video surface. No second player, no duplicate media session.
- Desktop: 1080p RSS video plays without frame drops on the reference machine; 4K is not a
  gate. The audio path must not regress when video is disabled.
- Startup: no companion call during launch unless a due YouTube feed is being refreshed.
  Companion timeouts do not block the music UI.
- Downloads: RSS video pins respect quota; the size estimate is shown before download; a
  failed pin leaves no partial row; YouTube exposes no pin.
- Feed lists: bounded backfill, paged episode queries (existing 50) and windowed rendering.
- Memory: an hour-long 1080p video pin is a file on disk, not an in-memory buffer.

## 6. Migration and compatibility

- Desktop migration 7 is additive; the pre-migration `VACUUM INTO` backup still runs. A
  migration test starts from a real v6 database with music, podcasts, queue, downloads and
  cache rows and asserts unchanged music/podcast behavior.
- Android v7 → v8 and iOS 6 → 7 are additive and idempotent. Old rows read as audio.
- Older hosts without `CompanionBridge` or `mediaForm` keep working: the renderer hides
  video controls and the YouTube source entry point. `Track.mediaForm` is optional on the
  wire.
- No existing music or podcast queue, download or play-history row is rewritten.
- A downgrade is not supported; the existing backup/restore guidance applies.

## 7. Testing and evidence

| Layer | Required |
| --- | --- |
| Parser | Video-only, audio+video, `media:content`, multiple enclosures, bad MIME, oversized alternate list, relative URLs, SSRF |
| Classification | Declared/manual/inferred/excluded; thresholds 20/45; Shorts; live/upcoming; duration unknown; channel override; reason text |
| Contracts | Optional `mediaForm` on old payloads; `setPresentation`; schema fixtures for video and alternates |
| Repository | Migration 7 from real v6 data; idempotent YouTube import; no orphan media items; alternate serialization |
| Protocol | Video MIME, Range/HEAD for a video enclosure; YouTube resolver cache, expiry, 401/403/404/429 mapping |
| Desktop E2E | Video RSS episode: play, video visible, audio-only toggle, minimize, media key, PiP/fullscreen where available, restart/resume |
| Desktop YouTube | Fixture companion: pair, probe, add channel, classify, stream audio in background, unpair, companion offline |
| Android | Room v8 migration; full-screen video; surface detach; screen-off audio; PiP; media session; no extraction in APK |
| iOS | SQLite v7 migration; AVPlayerLayer; PiP; screen-off audio; YouTube entry point absent |
| Car | Audio-only browse/play; no video template; companion-unreachable state |
| Security | Token/cookie/media-URL redaction; bridge version/auth; no arbitrary URL proxy; no yt-dlp symbols in core artifacts |
| Performance | Screen-off 60-minute audio; hidden video decode; 1080p playback; large pin/quota; startup |
| Legal/UX | Notice before first YouTube source; store copy review; experimental labelling; no unsupported claims |

Live YouTube resolution is **not** a CI gate. The companion contract is tested against a
fixture HTTP server. Live tests are manual, time-boxed, record the companion version, date,
region and result, and are marked BLOCKED when YouTube refuses the request.

Evidence reports S054–S062 follow `evidence/TEMPLATE.md`, with command, exit code,
environment, logs and artifacts. Unit tests alone do not make a platform gate VERIFIED.

## 8. Slice map

| Slice | Scope | Depends on |
| --- | --- | --- |
| S054 | Contracts, migration 7, Room v8, iOS v7, episode mapping for media form and alternates | MVP-5 S042 |
| S055 | Video enclosure parsing and selection, classification for declared video, poster/size metadata | S054 |
| S056 | Desktop video presentation: `<video>`, PiP, fullscreen, audio-only, background/media session | S054, S055 |
| S057 | Android video presentation: PlayerView, PiP, surface detach, screen-off audio | S054, S055 |
| S058 | iOS video presentation: AVPlayerLayer, PiP, screen-off audio | S054, S055 |
| S059 | Companion contract, pairing, status, fixture bridge, desktop client | S054 |
| S060 | Desktop YouTube source: probe, add, refresh, classification, resolved playback | S055, S059 |
| S061 | Android companion over LAN, car browse eligibility, no-extraction audit | S057, S060 |
| S062 | Cross-platform verification, performance, legal/UX review, release gate | S056–S061 |

S054–S055 can start before the MVP-5 gate closes. S056–S058 are independent of the
companion. S059–S061 are the YouTube path and may ship later than video RSS playback; they
do not block the compliant video feature.

## 9. Release gate (MVP-6)

All of the following are required before MVP-6 is called VERIFIED:

1. An RSS video podcast plays on desktop, Android and iOS; video is visible when requested,
   audio-only works, background/screen-off audio continues, and restart resumes correctly.
2. Music, audio podcasts, queues, radio, playlists, favorites, stats, downloads and cache
   show no regression. The one-authoritative-queue invariant still holds.
3. Desktop YouTube with the fixture companion: pair, probe, add a channel, classify by
   duration, play audio in the background, minimize the window, recover from a companion
   restart, and unpair. No token, cookie or media URL appears in logs or the support bundle.
4. Android YouTube over an authenticated LAN companion (or the feature is explicitly
   BLOCKED for that platform with a reproduction recipe). Screen-off audio is demonstrated.
5. iOS ships video RSS only; the YouTube entry point is absent, and the App Store build
   contains no extraction code. The limitation is documented in user-facing help.
6. An RSS video pin shows size, respects quota, plays offline and removes cleanly.
   Audio-only pins are offered where the feed provides an audio alternate. YouTube
   episodes are streaming-only and expose no pin action.
7. Legal/UX review signs off the notice, experimental labelling, store copy, the
   no-re-hosting posture and the no-YouTube-downloads decision.
8. Security checks pass: companion auth/version, no arbitrary URL proxying, SSRF on feed
   URLs, redaction, no yt-dlp/ffmpeg/Python artifacts in core bundles.
9. Performance gates pass on the named desktop/mobile references: hidden-video CPU/battery,
   1080p playback, large RSS video download and startup without a companion.
10. Evidence S054–S062 is complete. Runtime-only or legal gates that remain open are called
    out as BLOCKED; they are not reported as passing.

## 10. Risks and open questions

| Risk | Mitigation / decision |
| --- | --- |
| YouTube extraction is against ToS and may break | Optional, off by default, separate companion, explicit notice, no core dependency, no store distribution, no support claim |
| YouTube PO-token/client changes break resolution | Companion owns updates/PO-token provider; app treats it as a disposable resolver; fixture-tested contract, live tests time-boxed |
| GPL/AGPL contamination | No extractor in core; companion separate; separate Android plugin (if any) is a distinct licensed artifact |
| App Store rejection on iOS | No YouTube extraction on iOS; RSS video only; store copy review |
| Users expect YouTube on every platform | Platform matrix and release notes state desktop/Android-via-companion; iOS explicitly unsupported |
| Video downloads are huge | RSS video only; size estimate, quota, opt-in, audio-only alternate, cleanup |
| YouTube downloads add copyright/ToS exposure | Streaming-only for YouTube sources; pin action hidden; no persistent copies |
| Background battery drain from hidden video | Detach surface, audio-only preference, measure screen-off; no video decode in background |
| Two video surfaces / duplicate audio | One engine and one active surface invariant; tests for PiP + background, mini player + full screen |
| HLS-only streams | v1 requires progressive audio/video from the companion; HLS deferred until all targets consume it |
| Feed advertises video but content is audio | Trust MIME first, verify content type on first play, allow manual form override |
| Classification mislabels music videos | Duration threshold, Shorts/live exclusion, manual override, reason shown, no auto-conversion of single URLs without confirmation |
| Companion token leaked on LAN | Localhost default, token required, LAN opt-in, recommend Tailscale/HTTPS, redacted diagnostics, unpair clears token |
| Video podcast playback destabilizes MVP-5 | Separate MVP-6 slices; S054/S055 additive; release gate after MVP-5; feature flag on desktop |
| No captions/transcripts | Explicit non-goal; do not imply accessibility coverage beyond controls |

Open questions for acceptance:

1. **YouTube risk:** accept the opt-in companion path (recommended), keep YouTube out
   entirely, or limit the first release to RSS video podcasts?
2. **Android:** companion-over-LAN first (recommended), an optional separate GPL plugin, or
   no Android YouTube support in MVP-6?
3. **iOS:** confirm RSS video only (recommended) rather than a bridge-only best-effort that
   risks App Store review.
4. **Classification default:** 20 minutes (recommended) or 45 minutes as the default, with
   both available as presets?
5. **Video downloads:** allow RSS video pins (recommended, opt-in with size warning) while
   keeping YouTube streaming-only? Or restrict all video pins to audio-only where possible?
6. **Milestone:** ship as MVP-6 after MVP-5 (recommended) or fold video into a 2.1.x
   release once MVP-5 is verified?
