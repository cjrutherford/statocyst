# Releasing Statocyst for Android

This is the operational plan for producing, signing and publishing an APK. It
assumes a standalone Android build: no Electron companion process.

## 1. Build the web assets

```bash
node node_modules/.bin/nx build desktop --skip-nx-cache
node node_modules/@capacitor/cli/bin/capacitor sync android
```

`capacitor sync` copies `dist/apps/desktop/browser` into
`android/app/src/main/assets/public`. Never edit that directory by hand.

## 2. Version the build

In `android/app/build.gradle`, bump both values before every published build:

```gradle
versionCode 2        // integer, strictly increasing
versionName "0.2.0"  // human-readable
```

Android only installs an upgrade when `versionCode` increases. A published
`versionCode` is immutable.

## 3. Signing key

A release key was generated for the `com.hopefulaspirationsindustries.statocyst`
application ID (RSA 4096, alias `statocyst`, valid ~30 years):

- keystore: `~/.statocyst-signing/statocyst-release.jks` (outside the repo)
- `android/keystore.properties` points at it (git-ignored); a copy of the
  properties file is kept at `~/.statocyst-signing/keystore.properties.bak`
- certificate SHA-256: `7d850daeb5e087ff221cc8ae9c590c2d2b381c7c911c069ee148fda8ee7be416`

**Back both files up somewhere off this machine.** Losing the key means future
builds cannot upgrade installed copies; users would have to uninstall and lose
local state. To regenerate (new identity, no upgrades from existing installs):

```bash
keytool -genkeypair -v -keystore ~/.statocyst-signing/statocyst-release.jks \
  -alias statocyst -keyalg RSA -keysize 4096 -validity 10950
```

and write `android/keystore.properties` with `storeFile`, `storePassword`,
`keyAlias`, `keyPassword`.

## 4. Build and verify

```bash
cd android
JAVA_HOME=/opt/android-studio/jbr ANDROID_HOME=$HOME/Android/Sdk ./gradlew clean assembleRelease
```

Verify the signature and that the APK is not debuggable:

```bash
$ANDROID_HOME/build-tools/<version>/apksigner verify --print-certs \
  app/build/outputs/apk/release/app-release.apk
```

Install over the previous build and exercise a cold start, library load,
playback, download and a settings change before publishing.

## 5. Publish

The tailnet Funnel serves `release/` (a plain `python3 -m http.server 8080`
bound to 127.0.0.1, fronted by `tailscale funnel`):

```bash
cp android/app/build/outputs/apk/release/app-release.apk \
  release/statocyst-android.apk
(cd release && sha256sum statocyst-android.apk > SHA256SUMS)
```

Then verify the public bytes match:

```bash
curl -s https://nirvana.tail5a4a0.ts.net/statocyst-android.apk \
  -o /tmp/statocyst.apk
sha256sum /tmp/statocyst.apk   # must equal release/SHA256SUMS
```

The current public download is
`https://nirvana.tail5a4a0.ts.net/statocyst-android-debug.apk`.

## 6. Upgrade expectations

The application ID changed from `net.christopherrutherford.statocyst` to
`com.hopefulaspirationsindustries.statocyst` in 1.0.0 (versionCode 16). Android
treats it as a different app: it installs alongside the old one, with a fresh
library and settings. Uninstall the old app after installing the new one so
Android Auto lists only one Statocyst. The Kotlin/Java package namespace is
unchanged (`net.christopherrutherford.statocyst`).

Release-signed and debug-signed builds of the same application ID cannot
upgrade each other. Use the release APK for real devices; the debug build is for
the emulator and `connectedDebugAndroidTest` (which uninstalls the app, so
reinstall the release APK afterwards).

One-step publish: `tools/android-publish.sh --release` builds the signed APK,
verifies the signature, publishes `statocyst-android.apk` and checks the public
bytes. `tools/android-publish.sh` (no flag) still publishes the debug APK.

## 7. Distribution integrity

- The Funnel host serves only the `release/` directory; no credentials are
  placed there.
- Every published APK has a `SHA256SUMS` file beside it.
- Release APKs are signed with the key in section 3; debug APKs use the standard
  Android debug key and are not a trust anchor.
- The app itself makes no analytics or update-check requests; users update by
  downloading the APK again.

## 8. Per-build checks and the Android Auto gate

Before publishing, run from the repo root:

```bash
node node_modules/.bin/nx run-many -t test --skip-nx-cache
cd android && ./gradlew :app:testDebugUnitTest :app:connectedDebugAndroidTest
```

`connectedDebugAndroidTest` needs a running emulator/device, uninstalls the app
afterwards and so clears its data. The instrumented tests seed their own
`zz-fix-*` fixtures and do not touch a pre-existing library, but expect to
re-import music after running them on a device you care about.

Publish with `tools/android-publish.sh` (bumps are manual, see section 2). It
builds, copies the APK and `SHA256SUMS` into `release/`, and verifies the public
bytes through the Funnel URL match the local file.

### Android Auto gate (S019)

Automated tests do not replace head-unit verification. Mark S019 `VERIFIED` only
after running the Desktop Head Unit (or a real car) and recording, in
`statocyst-architecture-pack/evidence/S019-report.md`: launcher icon present,
browse tree reachable, playback started from the tree, custom buttons, voice
search. For a sideloaded build the phone needs Android Auto developer settings
-> **Unknown sources**, and Statocyst ticked under **Customize launcher**.

## 9. CI and the GitHub release pipeline

- `.github/workflows/ci.yml` runs on every push: typecheck + tests for the web
  libs and apps, the Angular build, then Android unit tests and a debug APK
  (uploaded as an artifact). The emulator-based instrumented tests run for pull
  requests into `main` and on demand (Actions -> CI -> Run workflow).
- `.github/workflows/release.yml` runs when a tag `v<versionName>` is pushed
  (e.g. `git tag v1.4.0 && git push origin v1.4.0`). It refuses a tag that does
  not match `versionName`, runs the tests, builds the **signed** release APK,
  checks that the signing certificate is the one in section 3, and creates a
  GitHub Release with `statocyst-<version>.apk` and `SHA256SUMS` attached. A tag
  with a `-` (e.g. `v1.5.0-rc1`) is marked as a pre-release.

One-time setup: add these repository secrets (Settings -> Secrets and variables
-> Actions), from the key in section 3:

```bash
base64 -w0 ~/.statocyst-signing/statocyst-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD   # storePassword from keystore.properties
gh secret set ANDROID_KEY_ALIAS           # keyAlias
gh secret set ANDROID_KEY_PASSWORD        # keyPassword
```

The release job reads them only to write a temporary `keystore.properties`,
which is deleted at the end of the job. The Funnel publish in section 5 remains
the way to ship to the tailnet; bump `versionCode`/`versionName` before tagging.
