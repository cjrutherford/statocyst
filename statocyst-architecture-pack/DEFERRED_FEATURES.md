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
| User-supplied podcast feed URLs / OPML source onboarding | Not planned | Product decision: discovery-only via existing directories (ADR-036) |

Every deferred item must have rationale, owner (if known), blocking prerequisite and acceptance criteria before promotion into an active slice.
