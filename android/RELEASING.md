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

## 3. Create the signing key (once)

```bash
keytool -genkeypair -v \
  -keystore android/statocyst-release.jks \
  -alias statocyst \
  -keyalg RSA -keysize 4096 -validity 10000
```

Then create `android/keystore.properties` (both files are git-ignored):

```properties
storeFile=statocyst-release.jks
storePassword=…
keyAlias=statocyst
keyPassword=…
```

Back the keystore and its passwords up outside the repository. Losing the key
means future builds cannot upgrade installed copies — users must uninstall and
lose local state.

Current status: no release keystore exists yet. `assembleRelease` therefore
produces an unsigned APK, and the published artifact is the debug build.

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

## 6. Upgrade expectations from a debug install

Android refuses to install a release-signed APK over a debug-signed one with
the same `applicationId`. Plan one of these when moving to signed builds:

- Publish the signed release under a new `applicationId`
  (e.g. `net.christopherrutherford.statocyst.release`) so both can coexist, or
- announce a one-time uninstall/reinstall and treat local data as forfeited.

Until then, keep publishing the debug APK so existing installs upgrade in
place.

## 7. Distribution integrity

- The Funnel host serves only the `release/` directory; no credentials are
  placed there.
- Every published APK has a `SHA256SUMS` file beside it.
- Debug APKs are self-signed with the standard Android debug key and are not
  suitable as a long-term trust anchor.
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
