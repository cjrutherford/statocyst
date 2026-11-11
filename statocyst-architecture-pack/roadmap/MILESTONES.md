# Milestone gates — amendment to earlier MVP plan

## MVP-1 — Standalone Desktop Player (S000–S005)
**Status: VERIFIED (2026-10-27), reference OS: Ubuntu 26.04.1 LTS / Xwayland.** Evidence: `evidence/S000-report.md`–`evidence/S005-report.md`, `evidence/verification.log`, `evidence/screenshots/`.

A local file can be selected and played with real controls and a persistent queue, with no Jellyfin. This is **player first**. Desktop reference OS should be chosen by agent based on available build machine and documented, not assumed to represent all desktop OSes. Embedded libSQL must have a working local persistence path; if it does not, architecture is blocked, not silently replaced.

## MVP-2 — Jellyfin Connected Desktop (S006–S011)
Connect to stock Jellyfin with standard auth, safely store credentials, browse paginated catalog, stream real music, handle server down and restore local mode. No optional plugin needed.

## MVP-3 — Capacitor Android Mobile (S012–S017)
Angular app runs as Capacitor Android client. Native Media3 owns background playback; local catalog/queue and controls survive UI teardown. Android libSQL spike gate prior to dependent implementation.

## MVP-4 — Android Auto (S018–S023)
Native MediaLibraryService provides browser hierarchy and play commands without booting WebView. Native service reads locally persisted data, supports offline state appropriately; instrumented and automotive test evidence.

## Polish / Daily Driver (S024–S029)
Verified offline downloads, adaptive cache, UI accessibility, logs, reconnect, packaging and recovery. These features are **not implied** by merely completing MVP-4.

## Follow-on roadmap (plan separately)
Intelligence, federation, multi-device enhanced sync, extensibility, iOS/CarPlay, localization expansion and mature release infra. Design intent already approved, implementation remains gated.

## Criteria for progressing
Each milestone: all slices VERIFIED, meaningful end-to-end demo on real target runtime, no unresolved critical security/data-loss defect, evidence manifest completed, explicit release readiness decision. Scope changes need record in ADR/deferred register.


## Rural Offline + iOS/CarPlay (S030–S039)
**Status: IN_PROGRESS (2026-11-05).** Branch `feature/rural-offline-parity`.

Promotes the rural-offline evaluation into slices: size truth, quality-aware pins, storage and
metered policy, resilient playback, iOS offline parity, sparse cache, collection prefetch,
durable transfers, mobile UX, and CarPlay audio. Evidence lives in `evidence/S030-report.md`–
`S039-report.md`. iOS and CarPlay are no longer deferred (ADR-034); entitlement and head-unit
validation remain external gates.

## MVP-5 — Podcasts, all platforms (S042–S053)
**Status: IN_PROGRESS / BLOCKED (2026-11-08): desktop + Android core implemented; iOS/CarPlay gates open.** Decision: ADR-036. Plan: `roadmap/PODCASTS.md`.

Statocyst becomes a local-first podcast client without weakening the music player. Users
discover shows through keyless Apple Podcasts and Fyyd directories and subscribe in one tap;
the host resolves the publisher RSS/Atom feed, fetches, parses, stores and refreshes it
locally. Users do not paste feed URLs, import OPML as a source, or enter directory API keys. Episodes are a first-class `media_kind`, stream
through the existing media protocol and can be pinned for offline use. Music and podcast
queues are persisted separately with exactly one authoritative active queue at a time;
episodes get per-episode resume, played/completed state, speed and skip intervals.

All platforms ship together: Electron desktop, Android (Media3), iOS (AVPlayer), Android
Auto and CarPlay. No platform may be claimed unless its slice gate is verified. Cross-device
podcast sync, automatic per-show retention, background feed refresh while suspended,
chapters/transcripts and publishing an aggregate feed are explicitly deferred.

Release requires the ten-point gate in `roadmap/PODCASTS.md` §18 and evidence in
`evidence/S042-report.md`–`S053-report.md`.

## MVP-6 — Video podcasts and optional YouTube sources (S054–S062)
**Status: PLANNED (2026-11-11).** Decision: ADR-037 (proposed). Plan: `roadmap/VIDEO_PODCASTS.md`.

Video podcast episodes become a presentation of the existing podcast media kind, not a new
kind: `media_form` plus alternate enclosures, a real video surface, PiP/fullscreen and
audio-only mode. Audio remains authoritative and continues when the window is minimized,
the app is backgrounded or the screen is locked. RSS video podcasts work on desktop,
Android and iOS.

Podcast-length YouTube videos can be added as episodes through an optional, separately
installed, user-run **Statocyst Companion**. The companion owns extraction, cookies and
PO-token handling; core Statocyst contains no YouTube extractor. The feature is off by
default, explicitly experimental, and not available on iOS because there is no supported
on-device extractor and it creates App Store risk. YouTube extraction is against YouTube's
terms; the RSS video path is the compliant path. No content is re-hosted or redistributed.

Desktop, Android (via companion), and iOS (RSS video only) do not ship as parity claims.
Platform gates are recorded independently: a failed companion, PiP or screen-off gate is
BLOCKED, not “working”. Release requires the ten-point gate in `roadmap/VIDEO_PODCASTS.md`
§9 and evidence in `evidence/S054-report.md`–`S062-report.md`. Do not start MVP-6 release
work before the MVP-5 gate passes or the product owner explicitly re-scopes.
