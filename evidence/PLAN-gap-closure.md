# Gap-closure plan (slices 11-17)

Follows the 10-slice Android/Auto overhaul. Each slice ends with: tests green, an emulator check, a published APK (strictly increasing versionCode), an `evidence/S0NN-...-report.md`, and a local commit.

| # | Slice | Gap closed | Done when |
|---|---|---|---|
| 11 | DHU harness + controller policy hardening | Head-unit lockout risk; S019 gate not runnable | `tools/dhu.sh` downloads and launches the DHU; policy trusts system-signed controllers, logs denials, and Settings shows denied packages with an "Allow" action; unit tests |
| 12 | Resume position + large queues | Resume loses position; ~300 queue cap | Position persisted and restored through `onPlaybackResumption`; browse/context queues handle 2,000+ tracks; tests |
| 13 | Jellyfin artwork without `api_key` | WebView/browser fallback leaks token in URLs | No `api_key` in app code; native authenticated artwork route with disk cache; browser fallback uses header fetch; tests |
| 14 | Jellyfin integration tests | InstantMix and auth paths only unit-tested | In-process fake Jellyfin covers auth, items, InstantMix, stream/artwork headers; run in CI-less `testDebugUnitTest` |
| 15 | Device matrix | One emulator, no tablet/landscape | Scripted screenshots at small phone, tablet portrait/landscape, font scale 1.3, light/dark; layout bugs fixed |
| 16 | Release signing | Debug-signed APK only | Optional `keystore.properties`-driven release config + `android-publish.sh --release`; key creation and applicationId choice need the user's decision |
| 17 | Verification and release | Final proof | All suites rerun, S019 report updated (VERIFIED only if a DHU/car run is recorded), `RELEASING.md` updated, final APK |

Out of scope / needs the user: real-car or phone-attached DHU run (slice 11 provides the script), a real Jellyfin server run, and any signing key.
