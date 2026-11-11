# Deferred feature register

Do not build the following in MVP-1..MVP-5 unless a specifically accepted dependency spike is required.

| Capability | Target after MVP | Dependency/gate |
|---|---|---|
| Full adaptive 2-tier offline storage/downloads | Polish | Native cache and source lifecycle proven |
| Automatic endpoint racing and network adaptation | Polish | Authenticated endpoint identity and connectivity benchmarks |
| Gapless / crossfade and advanced DSP | Polish / later | Each platform native engine verified |
| Full Statolith hybrid recommender and vector embeddings | Intelligence | libSQL indexing and provenance validated |
| Local acoustic feature extraction | Intelligence | Benchmark resource budgets and quality |
| Enhanced sync via plugin or companion | Expansion | Protocol version/capability and idempotent event contract |
| Multi-server logical-recording federation | Expansion | Source-aware identity and permission tests |
| Remote metadata/file mutation | Expansion | Explicit write capability, permission and audit |
| Third-party extension SDK/execution | Expansion | Enforced isolation and compatibility |
| macOS notarization and broad distro packaging | Progressive | Signed/reproducible CI builds |
| iOS/CarPlay | **Promoted** | Superseded for this programme by ADR-034: iOS parity is S034, CarPlay audio is S039. Entitlement approval and a real head unit remain external gates. |
| Bit-perfect output | Research | Platform-specific output path evidence |
| Rich multi-device preference vector sync | Expansion | Validated provider and privacy/tombstone semantics |
| Podcast background feed refresh while suspended | After MVP-5 | Android WorkManager / iOS BGTaskScheduler plus a shared refresh policy; foreground/manual refresh ships in MVP-5 |
| Podcast auto-download / per-show retention | After MVP-5 | Storage budget and cleanup policy validated with manual pins first; MVP-5 ships manual episode pins |
| Podcast chapters, transcripts, live items, alternate enclosures, value/streaming metadata | After MVP-5 | Schema fields reserved; Podcast 2.0 fixture coverage and UX design required |
| Podcast sleep timer and automatic intro/outro skipping | After MVP-5 | Native engine timing and accessibility validation; MVP-5 ships manual skip buttons |
| Cross-device podcast subscription/resume sync | Expansion | Requires the accepted offline-first sync provider and privacy/tombstone semantics |
| Global unified music + podcast search and recommendations | Expansion | Media-kind-aware ranking and UI design; MVP-5 keeps podcast search local to Podcasts |
| Podcast aggregate feed publishing / audio re-hosting | Not planned | Conflicts with local-first aggregation and content licensing; no accepted use case |
| User-supplied podcast feed URLs / OPML source onboarding | Not planned | Product decision: discovery-only via existing directories (ADR-036); the YouTube source is an explicit exception for a host-owned adapter, not a general RSS URL form |
| Video podcast playback (RSS video enclosures) | **Promoted to MVP-6** | Planned in S054–S058 under ADR-037; requires MVP-5 gate first or explicit re-scope |
| Podcast-length YouTube sources via a local companion | **Promoted to MVP-6 (desktop/Android only)** | Planned in S059–S061 under ADR-037; opt-in, unofficial, against YouTube ToS, no core extractor, no iOS support |
| Bundling yt-dlp/ffmpeg/Python/NewPipe in core or store builds | Not planned | Legal/ToS, GPL linking and App Store risk; extraction stays in a separately distributed companion |
| On-device YouTube extraction on iOS | Not planned | No supported extractor, App Store rejection risk; iOS ships RSS video only |
| HLS playback for video podcasts | Deferred after MVP-6 | v1 requires progressive audio/video from the companion; HLS needs a renderer/native strategy |
| Embedded video inside the mobile WebView | Deferred after MVP-6 | v1 uses a native full-screen surface and PiP; an embedded surface needs native overlay geometry |
| Video live streams, premieres and Shorts as podcast episodes | Not planned | Classification excludes them by default; live playback is a different capability |
| RSS video downloads / large video pins | MVP-6, opt-in | Planned in S055/S056; size warning, quota, audio-only alternate |
| Persistent YouTube downloads / pins | Not planned | Adds copyright and ToS exposure on top of stream extraction; YouTube sources are streaming-only |
| Cross-device video resume, casting and AirPlay/Chromecast | Expansion | Requires the accepted sync/casting design; not part of MVP-6 |

Every deferred item must have rationale, owner (if known), blocking prerequisite and acceptance criteria before promotion into an active slice.
