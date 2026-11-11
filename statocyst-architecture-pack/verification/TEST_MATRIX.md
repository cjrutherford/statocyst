# Test matrix

| Domain | Early automated | Integration | Physical / platform gate |
|---|---|---|---|
| Desktop local playback | Queue/model tests | Real file and packaged app | Named desktop OS demonstration |
| Jellyfin | Contract/mock tests | Dockerized **stock** Jellyfin versions | Authenticated playback on real runtime |
| libSQL | Migration/repository tests | Concurrent reads/writes, vector spike | Android ABI + service cold-start gate |
| Capacitor | Bridge unit tests | Gradle Android build and instrumentation | Android lifecycle and audio focus |
| Android Auto | Browse fixture tests | Head unit/Desktop Head Unit emulator | Physical phone + automotive setup |
| Offline | Download/cache tests | Network blocked, storage pressure | Airplane mode and restart |
| Security | Credential redaction, IPC input | TLS/endpoint spoof simulation | Device credential lifecycle |
| Podcast feeds | Parser/OPML/URL-safety fixtures | Local fixture server: 304, redirect, timeout, private-IP, XXE | Real feeds from several hosts; 100-feed / 10k-episode budget |
| Podcast playback | Two-context queue/resume/completion tests | Desktop E2E switch → resume → restart | Screen-off, process-death and lock-screen evidence on Android/iOS |
| Podcast offline | Pin/precedence/cleanup tests | Network-blocked playback of a pinned episode | Airplane-mode playback and feed-removal cleanup |
| Podcast discovery | Podcast Index adapter tests | Test key + cached search; OPML round-trip | Real key entry on each platform, secret redaction |
| Podcast car surfaces | Browse-tree/template fixtures | Desktop Head Unit / CarPlay simulator | Real head unit where available; record BLOCKED otherwise |
| Video podcast parsing | Video-only/audio+video/alternate fixtures, SSRF | Local fixture feed server | Real video feeds from several hosts |
| Video playback | Media-form/engine/protocol tests | Desktop E2E video → audio-only → minimize → restart | Android/iOS full-screen, PiP, screen-off and lock-screen evidence |
| YouTube classification | Duration/Shorts/live/manual rule tests | Fixture companion probe/add/refresh | Manual live probe with companion version, date and region; record BLOCKED when refused |
| Companion bridge | Pairing/version/auth/error/redaction tests | Fixture HTTP server, Range/HEAD, timeout | Real paired companion over localhost and LAN |
| Video downloads | Size/quota/cleanup tests | Network-blocked pin playback | Large-file download and offline playback on device |
| Video packaging/legal | No-extraction artifact audit | Store-copy and notice review | Signed build inspection; App Store policy review |
| Performance | 10k/50k/100k synthetic | Measured baselines | Device tiers and battery measurement; screen-off 60-minute audio; hidden-video CPU |
| Release | Migration and rollback fixtures | Package install/restart | Signed build and install smoke test |

Do not set arbitrary global performance thresholds without measured named reference hardware.
