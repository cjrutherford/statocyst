# ADR-035 — Offline quality profiles and resumable transcodes

**Status:** Proposed (gate: Range probe)
**Depends on:** S030, S031

## Context
Pins currently fetch `/Audio/{id}/stream?static=true`, i.e. the original bytes. A FLAC
library is roughly ten times the size of an Opus 96 kbps copy. Rural users need a smaller
offline copy, but a progressive transcode endpoint usually does not support byte ranges.

## Decision (proposed)
1. Add `original | balanced | saver` per pin; the default stays `original`.
2. `balanced` = AAC 128 kbps; `saver` = Opus 96 kbps on Android, AAC 128 kbps on iOS.
3. Store `profile`, `codec`, `bitRate`, `sourceBytes` on the download row.
4. A saver pin is only shippable if a `Range: bytes=N-` probe resumes. If the endpoint
   cannot resume, pre-transcode server-side into a cached file, or restart with a clear
   warning — never claim resumability that does not exist.
5. The master file and the offline copy are independent; online playback may still use the
   master when the connection allows.

## Gate
Record the probe result (URL, status, `Accept-Ranges`, `Content-Range`) against the target
Jellyfin server before S031 implementation. Otherwise S031 is BLOCKED.
