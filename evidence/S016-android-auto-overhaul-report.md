# S016 — Release signing and application ID

- applicationId changed to `com.hopefulaspirationsindustries.statocyst` (user-chosen; spelled "statocyst" after confirming the "staocyst" in the request was a typo). Java/Kotlin namespace unchanged, so no source moves. Also updated: `capacitor.config.ts`, `strings.xml`, and the PKG constant in the three `tools/` scripts.
- Release key generated (RSA 4096, alias `statocyst`, ~30 years) at `~/.statocyst-signing/`; `android/keystore.properties` is git-ignored. Cert SHA-256 `7d850dae…e416`.
- `build.gradle`: `signingConfigs` moved ahead of `buildTypes` (the existing order failed to evaluate once a keystore existed).
- `tools/android-publish.sh --release` builds, runs `apksigner verify`, publishes `statocyst-android.apk`, and compares public bytes.
- Side effect: the new ID installs next to the old app with empty data; the old app must be uninstalled manually.
- Release builds are non-debuggable, so `run-as` based tools (`android-seed-fixtures.py`) only work on debug builds.
