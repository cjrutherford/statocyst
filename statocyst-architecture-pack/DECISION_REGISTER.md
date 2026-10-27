# Accepted decision register — 2026-10-26

User-selected decisions; source of truth for planning. No implementation status implied.

| # | Subject | Choice | Accepted intent |
|---|---|---|---|
| Q01 | Progressive server enhancements | D | Stock Jellyfin core; optional plugin/companion capabilities |
| Q02 | Embedded database | A | Embedded libSQL across runtimes, validate native support |
| Q03 | Playback engines | B | Native engines behind shared contracts; Media3 on Android |
| Q04 | Offline cache | D | Adaptive rolling cache plus non-evictable explicit downloads |
| Q05 | Recommendations | D | Explainable hybrid explicit, behavioral, vector ranking |
| Q06 | Cross-device sync | D | Offline-first provider-based event sync |
| Q07 | Music analysis | D | Progressive provenance-aware multi-source analysis |
| Q08 | Platforms | D | Android/Auto and desktop; progressive macOS, iOS/CarPlay |
| Q09 | Federated libraries | D | Multi-server unified view with preserved source identity |
| Q10 | Authentication | D | Stock login plus optional capability-driven SSO/device pairing |
| Q11 | Audio quality | D | Direct-play-first adaptive quality user policies |
| Q12 | Playback queue | D | Persistent unified queue, gapless goal, optional crossfade, radio |
| Q13 | Data sovereignty | D | Configurable private history, selective sync, export/deletion |
| Q14 | Metadata | D | Personal overlays; authorized server editing optional |
| Q15 | Extensions | D | First-party adapters first; eventual permission-scoped SDK |
| Q16 | Interface | D | Adaptive accessible themes and layout |
| Q17 | Background jobs | D | Persistent resource-aware scheduling |
| Q18 | Releases | D | Signed builds, safe migrations, recovery, staged channels |
| Q19 | Diagnostics | D | Local first diagnostics; opt-in external reporting |
| Q20 | Agent verification | D | Risk-based, evidence-backed slice acceptance |
| Q21 | Monorepo | D | Nx orchestration with native Gradle/Xcode authority |
| Q22 | MVP strategy | D | Vertical slice milestones; revised to player→Jellyfin→Capacitor→Auto |
| Q23 | Licensing | D | Open-source core, component licenses pending audit |
| Q24 | Stewardship | D | Independent project identity with optional ecosystem ties |
| Q25 | Localization | D | i18n-first community translations |
| Q26 | Server discovery | D | Guided discovery with verified endpoints and secure failover |
| Q27 | Security | D | Layered threat-model-driven controls |
| Q28 | Performance | D | Measured tiered budgets and regression tests |
| Q29 | CI | D | Pinned hybrid CI with container fixtures and device testing |
| Q30 | Scope | D | Full architectural vision, bounded slices and deferred register |

**Q30 clarification:** deliver multiple MVPs in strict user-requested order: standalone player → stock Jellyfin connected → Capacitor mobile → Android Auto → polish. This supersedes the previous daily-driver ordering.
