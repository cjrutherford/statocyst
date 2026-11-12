# Statocyst product contract

**Purpose.** Independent, open-source, local-first Jellyfin-oriented music application delivering modern playback and user control, with optional intelligent discovery and optional integrations. Named after the jellyfish orientation organ.

**Primary contexts.** Local desktop music; connected desktop Jellyfin music; Capacitor Android; native Android Auto; subsequent desktop platform polish, iOS and CarPlay.

**Non-negotiable invariants**
- No additional Jellyfin server extension is required for core Jellyfin authentication, browse and playback.
- Native Android playback and Android Auto must function without an active Angular WebView.
- Exactly one authoritative playback queue per running platform instance.
- Embedded libSQL is the accepted database design; support must be validated per runtime before dependent features are considered ready.
- Credentials never reside as plaintext access tokens in catalog database records or logs.
- Local music playback is possible without a Jellyfin server and without network access.
- Explicitly downloaded music is protected from routine cache eviction; transient cache is best-effort, not an offline guarantee.
- No silent HTTP downgrade or unverified server identity reuse across endpoints.
- Extensions and optional providers cannot bypass security or privacy contracts.
- Every completion claim cites executed tests/evidence, including real-device evidence when required.

**MVP definitions**

### MVP-1 — Standalone Player
Single supported desktop reference target first. Open a locally selected music file; read supported metadata, show now-playing and basic browsing of imported local files; play, pause, seek, skip, queue edit, queue survives restart. Gracefully reject unreadable file. Use native-backed/Electron-compatible playback engine and shared contract. No server or mobile dependency. Record library scope and source provenance in Statolith as it becomes available. No claim of bit-perfect or gapless support yet.

### MVP-2 — Jellyfin Connected
Support manual Jellyfin URL, trusted transport, standard login, secure token storage, real server profile, paginated initial audio catalog sync and re-sync, metadata/artwork, browse/search, authenticated direct play or supported transcode fallback. Preserve standalone mode. Stock Jellyfin compatibility with versioned test fixtures.

### MVP-3 — Capacitor Android
Shared Angular presentation in Capacitor; Kotlin Media3 service authoritative for audio and queue; phone login, browsing, playback, Android background media-session control, native database access and persistence. Does **not** claim Android Auto readiness yet.

### MVP-4 — Android Auto
MediaLibraryService browses locally indexed catalog and queue without WebView startup; proper session and driver-safe templates; safe handling of authenticated sources and offline states. Prove cold-start behavior on supported Android hardware and automotive test environment.

### Polish / Daily Driver
Explicit downloads, rolling cache, endpoint resilience, accessibility, diagnostics, advanced playback/quality settings, packaged platform releases. Subsequent staged capability delivery follows accepted roadmap.

### MVP-5 — Podcasts (all platforms)
Discovery-first local RSS/Atom aggregation through keyless Apple Podcasts and Fyyd search (optional app-configured Podcast Index); users subscribe in one tap without pasting feed URLs, importing OPML sources, or entering API keys. Episodes are a first-class media kind with their own persisted queue, per-episode resume, played state, speed and skip intervals; they stream through the existing media protocol and can be pinned for offline use. Music and podcast queues are persisted separately, but exactly one is authoritative and active at a time, preserving the one-authoritative-queue invariant. Desktop, Android, iOS, Android Auto and CarPlay ship together. The app does not publish an aggregate feed, re-host audio, scrape directories, auto-download episodes, or sync podcast state across devices in this MVP. See ADR-036 and `roadmap/PODCASTS.md`.

**MVP-6 — Video podcasts** (accepted design intent 2026-11-11; implementation in progress): video enclosures and audio/video alternates published by a podcast's own RSS/Atom feed, with video surfaces, PiP, background audio and optional compressed offline copies. YouTube and other third-party platform extraction are explicitly out of scope. See ADR-037 and `roadmap/VIDEO_PODCASTS.md`.

**Explicit early non-goals**: SSO, custom syncing service, extensions marketplace, acoustic ML analysis, multi-server duplicate merges, iOS, CarPlay, complete federated playlists, crossfade and production-quality algorithmic recommendations for MVP-1 through MVP-4. They remain in the long-term specification.
