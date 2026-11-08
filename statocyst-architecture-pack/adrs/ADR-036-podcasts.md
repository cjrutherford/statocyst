# Podcasts as a first-class media kind

**Status:** Accepted design intent (scope confirmed 2026-11-08); implementation unverified unless evidence is linked.
**Date:** 2026-11-08
**Target:** MVP-5 — Podcasts, all platforms in one release.

## Decision

Statocyst will aggregate podcasts from external RSS/Atom feeds into a local-first podcast
library. Podcasts are a **first-class media kind**, not a clever reuse of the music album
model, and not a publishing feature.

1. **Local aggregation.** Users discover a show in an existing directory and subscribe in
   one tap. The host resolves the publisher RSS/Atom feed, fetches, validates, parses,
   stores and refreshes it locally. Statocyst does not publish or re-host an aggregate feed,
   and does not proxy podcast audio for third parties.
2. **Discovery, not URL entry.** The Podcasts section is a discovery mechanism. Users must
   not paste feed/site URLs or import OPML as an aggregation source. The first release
   queries keyless **Apple Podcasts (iTunes Search API)** and **Fyyd** directly, and may
   include **Podcast Index** when the application is built with developer-provided
   credentials. No user API keys. No scraping. The Podcasts screen separates **Subscribed**,
   **Downloaded** and **Discovery**; Discovery opens on Apple's keyless top-show chart with
   categories and category rows derived from the genres carried by those shows, and keeps
   search as a secondary action.
3. **Separate media identity.** Episodes are stored as `media_item` rows with
   `media_kind = 'podcast'` plus `podcast_feed` / `podcast_episode` side tables. Music
   queries, stats, radio, playlists and the existing library views exclude podcast rows.
   The reuse is deliberate: playback, queue persistence, downloads, cache, range requests
   and the bridge keep one implementation.
4. **One engine, two contexts.** Each running instance still has exactly one authoritative
   playback engine and one active audio context. Music and podcast queues are persisted
   separately; exactly one is active and authoritative at a time. The inactive context is
   stored state, not a second player. Switching context pauses the outgoing context and
   restores the incoming one. Per-episode resume, played/completed state, speed and skip
   intervals are podcast-only.
5. **Stream first, pin manually.** Episodes stream through the existing
   `statocyst-media:` protocol. Users may pin individual episodes for offline use. Pins
   share the existing download quota and are protected from cache eviction. Automatic
   per-show retention is deferred.
6. **Host-side fetching.** Directory search, feed, artwork and enclosure requests are made
   by the host (Electron main, Android OkHttp, iOS URLSession), never by the WebView. The
   RSS/Atom parser and directory normalizers are shared TypeScript libraries; mobile hosts
   expose fetch + persistence methods to the shared renderer. Optional provider secrets are
   developer-supplied/environment-configured, never asked from the user or stored in the
   renderer.
7. **Untrusted feed content.** Feed HTML is never rendered raw. The first release stores a
   plain-text description plus extracted safe links. Artwork is cached locally instead of
   hotlinked where possible. Feed, redirect, artwork, enclosure and download URLs all pass
   the same private-network/URL safety gate.
8. **All platforms in MVP-5.** Electron desktop, Android (native Media3), iOS (native
   AVPlayer) and the existing Android Auto / CarPlay surfaces ship together. A platform
   that cannot meet its gate blocks the release rather than shipping a partial story.

## Required implementation controls

- Before implementing, identify platform-dependent and API-dependent assumptions.
- Attach evidence for all acceptance criteria in the relevant slice.
- Document incompatible requirements and obtain a new ADR decision; never silently
  substitute another architecture.
- Keep feed content, credentials and private feed URLs out of logs and support bundles.
- Respect earlier decisions, especially the single authoritative queue, offline usability,
  security, privacy and user control.

## Consequences

- `media_source.kind` grows to include `podcast`; the desktop migration rebuilds that small
  table inside a deferred-foreign-key transaction. Mobile has no source table, so it only
  gains a `mediaKind` column.
- `playback_state` gains `active_context`; podcast queue and playback state get their own
  tables. The music queue survives untouched.
- New dependencies are limited to one actively maintained XML parser and, if needed, a
  small sanitizer. No podcast SDK, no analytics, no directory scraper.
- Cross-device subscription sync is **not** in this programme. Subscriptions, resume
  positions and downloads remain per device unless a later sync slice is accepted.
- User-supplied feed URLs and OPML source import are **not** part of the consumer flow.
  OPML may be retained only as a developer diagnostic, never as an onboarding path.

## Verification

See `roadmap/PODCASTS.md`, the slice gates S042–S053, and
`verification/TEST_MATRIX.md`. No passing tests are asserted by this document.
