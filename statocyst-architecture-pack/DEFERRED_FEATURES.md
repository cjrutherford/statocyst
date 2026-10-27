# Deferred feature register

Do not build the following in MVP-1..MVP-4 unless a specifically accepted dependency spike is required.

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
| iOS/CarPlay | Progressive | libSQL iOS feasibility, entitlements, native AVFoundation/CarPlay tests |
| Bit-perfect output | Research | Platform-specific output path evidence |
| Rich multi-device preference vector sync | Expansion | Validated provider and privacy/tombstone semantics |

Every deferred item must have rationale, owner (if known), blocking prerequisite and acceptance criteria before promotion into an active slice.
