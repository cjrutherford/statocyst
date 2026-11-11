# Video podcast and companion contract (planning sketch)

**Status:** PLANNED (2026-11-11). Language-neutral design intent; not a frozen wire format.
**Companion to:** ADR-037 and `roadmap/VIDEO_PODCASTS.md`.
**Version:** draft 0.1.

This document records the vocabulary that contracts, the database, the protocol and the
native engines must agree on. It does not assert an implementation.

## 1. Media vocabulary

```text
MediaKind        = music | podcast
MediaForm        = audio | video
Presentation     = audio-only | video
PodcastSourceKind = rss | youtube-channel | youtube-playlist | youtube-video | bridge
Classification   = declared | inferred | manual
StreamKind       = direct | resolved | hls
```

Rules:

- A video podcast is `MediaKind.podcast` + `MediaForm.video`. It is not a third media kind.
- `MediaForm` describes the primary enclosure; `alternates` carries the other usable forms.
- `Presentation` is a user/session choice, not persistence of the media identity. The
  default comes from settings, then the feed's `defaultMediaForm`, then audio.
- `StreamKind.resolved` means the host must obtain a fresh URL at play time. The URL is
  never persisted. `hls` is reserved and not accepted by the MVP-6 playback gate.

## 2. Episode payload

```json
{
  "id": "media-item-uuid",
  "episodeId": "episode-uuid",
  "feedId": "feed-uuid",
  "title": "Episode title",
  "mediaKind": "podcast",
  "mediaForm": "video",
  "sourceKind": "rss",
  "externalId": null,
  "sourcePageUrl": "https://example.com/episode",
  "enclosureUrl": "https://cdn.example.com/episode.mp4",
  "enclosureType": "video/mp4",
  "posterUrl": "statocyst-art://track/media-item-uuid",
  "videoWidth": 1920,
  "videoHeight": 1080,
  "alternates": [
    {
      "url": "https://cdn.example.com/episode.m4a",
      "type": "audio/mp4",
      "form": "audio",
      "lengthBytes": 48230000,
      "width": null,
      "height": null,
      "bitrate": 128000
    }
  ],
  "classification": "declared",
  "classificationReason": "Feed publishes a video enclosure",
  "streamKind": "direct"
}
```

For a YouTube-resolved episode:

```json
{
  "mediaForm": "audio",
  "sourceKind": "youtube-channel",
  "externalId": "dQw4w9WgXcQ",
  "sourcePageUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "enclosureUrl": "youtube://video/dQw4w9WgXcQ",
  "enclosureType": null,
  "streamKind": "resolved",
  "classification": "inferred",
  "classificationReason": "Video · 1h 12m · meets 20m podcast threshold"
}
```

`enclosureUrl` is a stable pseudo-URL. It is never fetched directly and never sent to the
companion as a URL. The host resolves by `episodeId` + `externalId` + requested form.

## 3. Playback additions

```ts
type Presentation = 'audio-only' | 'video';

interface PlaybackSnapshot {
  // ...existing fields
  mediaForm: 'audio' | 'video';
  presentation: Presentation;
}

type PlaybackCommand =
  // ...existing commands
  | { type: 'setPresentation'; mode: Presentation };

interface EngineLoadRequest {
  // ...existing fields
  mediaForm: 'audio' | 'video';
  posterUrl: string | null;
}
```

Semantics:

- `setPresentation` never creates a second engine, queue or media session.
- When both forms exist and a reload is required, the host reloads at the current position
  and reports a normal `trackChanged`/`ready` sequence. No resume state is lost.
- When only one form exists, `setPresentation` only attaches/detaches the video surface.
- `Snapshot.presentation` is `audio-only` for music. It is only meaningful for podcast
  episodes.

## 4. Companion HTTP contract (draft)

Base URL is user-configured, default `http://127.0.0.1:<port>`. All requests except
`/v1/health` require `Authorization: Bearer <token>`.

### 4.1 Health and pairing

```http
GET /v1/health
200 {"version":"0.1.0","capabilities":["youtube","progressive-media"],"paired":true}
```

```http
POST /v1/pair
{"code":"AB12-CD34","client":"Statocyst desktop 2.2.0"}
200 {"token":"...","bridgeId":"...","version":"0.1.0"}
```

- The code is short-lived and single-use, shown by the companion.
- The token is stored by the host in `safeStorage`/Keychain, never in the catalog.
- `DELETE /v1/pair` (or the app's unpair action) revokes the token on the companion.

### 4.2 Probe

```http
POST /v1/probe
{"url":"https://www.youtube.com/@example"}
200 {
  "kind":"channel",
  "externalId":"UC...",
  "title":"Example Show",
  "author":"Example",
  "artworkUrl":"https://...",
  "itemCount":240,
  "eligibleCount":86,
  "sample":[{"externalId":"...","title":"...","durationMs":4320000,"publishedAt":"2026-11-01T10:00:00Z","live":false}],
  "classificationNote":"86 of the newest 100 videos are at least 20 minutes"
}
```

`probe` is read-only. The app shows the result and the legal notice before calling
`addSource`. Probing a single video returns `kind="video"` with one sample item and a
confirmation prompt.

### 4.3 List and refresh

```http
POST /v1/list
{"sourceId":"UC...","cursor":null,"limit":50}
200 {"items":[...],"nextCursor":"..."}
```

Items carry at least `externalId`, `title`, `descriptionText`, `durationMs`,
`publishedAt`, `thumbnailUrl`, `live`, `upcoming`. The companion is responsible for
pagination and rate limiting. Statocyst bounds backfill (100 initial, 2,000 per feed).

### 4.4 Media

```http
GET /v1/media/<episodeId>?form=audio|video
Authorization: Bearer <token>
Range: bytes=0-1048575
```

Response requirements:

- `200` full or `206` partial; `Accept-Ranges: bytes`; correct `Content-Range`.
- Progressive bytes only for the MVP-6 gate. M4A/AAC or WebM/Opus audio; MP4 video.
- `Content-Type` is accurate; `Cache-Control: no-store`; no cookies or credentials in the
  URL.
- Hard timeout, size cap and a bounded queue. Errors map to 404/401/429/502 with a small
  JSON body; no extractor stack traces.
- `HEAD` is supported so the protocol can verify length/type without downloading.

### 4.5 Versioning

- `X-Statocyst-Bridge-Version` on every response; the app refuses a different major
  version and disables the source with a clear message.
- Capabilities are additive. Unknown capabilities are ignored. A missing
  `progressive-media` capability disables playback but not source management.
- The companion may add endpoints; Statocyst must not depend on undocumented ones.

## 5. Error mapping

| Companion result | Playback/UI result |
| --- | --- |
| Unreachable/timeout | `MEDIA_UNAVAILABLE`, "Companion not reachable" |
| 401/403 | `UNAUTHORIZED`, re-pair prompt; no retry storm |
| 404 (video removed/private) | `MEDIA_UNAVAILABLE`, episode stays in library |
| 429 / YouTube throttle | Retryable `MEDIA_UNAVAILABLE` with a wait; no automatic loop |
| Unsupported container | `UNSUPPORTED_MEDIA`; offer audio-only if available |
| Invalid response/version | `INTERNAL_ERROR` with a redacted diagnostic id |

## 6. Security invariants

1. The app never sends a feed-controlled URL to the companion. It sends an episode id that
   belongs to a paired source.
2. Pairing tokens, cookies and resolved media URLs never enter the catalog, renderer
   storage, logs or support bundles.
3. The companion endpoint is an explicit allowlist entry; redirects to other hosts are not
   followed by the protocol proxy.
4. The core app contains no extractor, Python runtime, ffmpeg binary or GPL extractor
   linkage. A packaging test asserts this.
5. iOS exposes no companion/YouTube surface; its build has no bridge client UI and no
   extraction code.
6. Video is never decoded while the screen is off; audio continues through the existing
   engine and background session.

## 7. Compatibility

- `Track.mediaForm` is optional on the wire. Older hosts omit it; the renderer treats it as
  `audio` and hides video controls.
- `PodcastEpisode.alternates` defaults to `[]`; older payloads remain valid.
- `CompanionBridge` is optional on `StatocystBridge`; absent means no YouTube entry point.
- Migration 7 is additive; a v6 database remains readable after upgrade and no music or
  podcast row is rewritten.
