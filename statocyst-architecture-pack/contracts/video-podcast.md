# Video podcast contract (planning sketch)

**Status:** PLANNED (2026-11-11). Language-neutral design intent; not a frozen wire format.
**See also:** ADR-037 and `roadmap/VIDEO_PODCASTS.md`.
**Version:** draft 0.1.

This document records the vocabulary that contracts, the database, the protocol and the
native engines must agree on. It does not assert an implementation.

## 1. Media vocabulary

```text
MediaKind    = music | podcast
MediaForm    = audio | video
Presentation = audio-only | video
```

Rules:

- A video podcast is `MediaKind.podcast` + `MediaForm.video`. It is not a third media kind.
- `MediaForm` describes the primary enclosure; `alternates` carries the other usable forms.
- `Presentation` is a user/session choice, not persistence of the media identity. The
  default comes from settings, then the feed's `defaultMediaForm`, then audio.
- `media_form` is declared by the feed. It is not inferred from duration, title or a
  third-party platform.

## 2. Episode payload

```json
{
  "id": "media-item-uuid",
  "episodeId": "episode-uuid",
  "feedId": "feed-uuid",
  "title": "Episode title",
  "mediaKind": "podcast",
  "mediaForm": "video",
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
  ]
}
```

An audio-only episode has `mediaForm: "audio"`, an empty `alternates` list and null video
dimensions. An episode with both forms is audio-primary by default, with the video in
`alternates`; the feed's `defaultMediaForm` can invert that.

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
- `snapshot.presentation` is `audio-only` for music. It is only meaningful for podcast
  episodes.

## 4. Protocol and downloads

- The media protocol keeps `statocyst-media://track/<id>`, Range/HEAD and redirect
  revalidation. Video MIME types are added to the allowlist; the upstream content type is
  passed through.
- `ProtocolTrack.mediaForm` lets the host apply a size/type policy. Podcast video remains a
  normal URL enclosure; there is no resolver kind.
- `DownloadView` gains `mediaForm` derived from the joined media item. No download table
  change is required.
- A video pin is the publisher's enclosure written through the existing `.part` → hash →
  rename flow. An audio alternate can be pinned instead when the feed provides one.

## 5. Contract invariants

1. One authoritative queue and one active media engine per runtime. Video presentation does
   not add a second player.
2. Audio continues when the video surface is detached. Video never owns the playback
   session.
3. All enclosure/alternate/poster/download URLs are `http:`/`https:` and pass the existing
   SSRF and redirect policy.
4. Feed-controlled content is never rendered as raw HTML or hotlinked by default.
5. No third-party platform extractor, downloader companion, Python runtime or GPL media
   library is part of the core build.
6. Media URLs and feed tokens are not logged in full; use episode id and host hash.
7. `Track.mediaForm` and `PodcastEpisode.alternates` are optional on the wire so older
   payloads remain valid.

## 6. Compatibility

- `Track.mediaForm` is optional. Older hosts omit it; the renderer treats it as `audio` and
  hides video controls.
- `PodcastEpisode.alternates` defaults to `[]`.
- Migration 7 is additive; a v6 database remains readable after upgrade and no music or
  podcast row is rewritten.
- A platform that cannot create a video surface still plays audio and reports
  `UNSUPPORTED_MEDIA`/`VIDEO_UNAVAILABLE` for the video presentation.
