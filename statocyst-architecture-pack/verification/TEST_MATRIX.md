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
| Performance | 10k/50k/100k synthetic | Measured baselines | Device tiers and battery measurement |
| Release | Migration and rollback fixtures | Package install/restart | Signed build and install smoke test |

Do not set arbitrary global performance thresholds without measured named reference hardware.
