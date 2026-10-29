# Publishing Statocyst to Google Play

What the repository still needs before it can be published on Google Play. The first section is
what Play requires; the second is where this repo stands today, so the open items are explicit.
Play policy changes often. Re-check each linked page in Play Console before submitting; the
facts below were checked on 2026-10-29.

Package name: `com.hopefulaspirationsindustries.statocyst` (permanent once the app is created).

## 1. Requirements

### Account and app
- A Play Console developer account (one-time registration fee, identity verification).
- **Personal accounts created after 13 Nov 2023** must run a closed test with **at least 12
  testers opted in continuously for 14 days** before they can apply for production access.
  Organization accounts are exempt but need a D-U-N-S number. If Google rejects the production
  request the closed-test period restarts. Budget about three weeks for a first launch.
  <https://support.google.com/googleplay/android-developer/answer/14151465>
- Create the app in Play Console (default language, free/paid, contact email).

### Build format and signing
- New apps must be uploaded as an **Android App Bundle (`.aab`)**, not an APK.
- **Play App Signing**: Google holds the app-signing key; we sign uploads with an *upload key*.
  The existing release key (see `RELEASING.md` section 3) can be enrolled as the upload key.
  APKs sideloaded from GitHub releases are signed with whatever key CI holds; if Play re-signs
  with a different key, sideloaded and Play installs cannot upgrade each other. Decide up front:
  either enroll the *current* key as the app-signing key (Play lets you upload an existing key
  on first upload) so both channels share one signature, or accept two separate lineages.
- `versionCode` must increase on every upload and cannot be reused (currently 22).

### Target API level
- New apps and updates must target **Android 16 (API 36)** or higher (deadline 31 Aug 2026).
  Existing apps must target API 35+ to stay visible to new users. The app targets 36.
  Google raises this every August; plan a yearly target-SDK bump.
  <https://developer.android.com/google/play/requirements/target-sdk>

### Store listing
- App name (30 chars), short description (80), full description (4000).
- App icon **512 x 512** PNG, feature graphic **1024 x 500**.
- At least 2 phone screenshots (larger tablet/Android Auto screenshots optional but recommended).
- Category (Music & Audio), contact email, **privacy policy URL** (required: the app handles
  server credentials and can send library metadata to a third party, see Data safety).

### App content declarations (Play Console > Monitor and improve > App content)
- **Privacy policy** URL.
- **Data safety** form, see section 3 below.
- **Content rating** questionnaire (IARC). The app plays user-provided content, no UGC sharing.
- **Target audience**: 18+/general, not directed at children.
- **Ads**: none. **App access**: reviewers cannot use the app without a media source, so provide
  instructions and/or a demo Jellyfin server and credentials, or ship test-fixture instructions.
- **Foreground service declarations**: each type used must be declared with the functionality
  and the user impact if stopped. Ours: `mediaPlayback` (`PlaybackService`, background music) and
  `dataSync` (`DownloadService`, offline downloads). All types are subject to review.
  <https://support.google.com/googleplay/android-developer/answer/13392821>
- **Notification permission** (`POST_NOTIFICATIONS`): used for the media/download notifications.
- **Media/copyright**: the app does not supply or host music; it plays the user's own files and
  their own Jellyfin server. State this in the listing and the app-access instructions.

### Android Auto
- The app declares `automotive_app_desc` (media). Play requires media apps for Auto to meet the
  Android for Cars app quality guidelines; they are reviewed. Run the manual gate in
  `RELEASING.md` section 8 (S019) against the Desktop Head Unit before each submission.
- Add the Android Auto form factor in Play Console (Release > Setup > Advanced settings) so the
  app is eligible there.

### Release flow
1. **Internal testing** track: up to 100 testers, no review wait. Use for smoke tests.
2. **Closed testing** track: needed for the 12-tester/14-day rule above.
3. Apply for **production access**, then roll out (use a staged rollout).
4. Check the **pre-launch report** (Firebase Test Lab crawl) on each upload for crashes.

## 2. Where the repo stands

Everything that can be done without account secrets is done on the `play-store-release` branch.

| Item | State | Notes |
| --- | --- | --- |
| Package name, targetSdk 36 | Done | Bump targetSdk yearly |
| Signed AAB | Done: `./gradlew bundleRelease` | Signs from `android/keystore.properties` or `STATOCYST_STORE_FILE/_STORE_PASSWORD/_KEY_ALIAS/_KEY_PASSWORD`; unsigned without either |
| R8 shrinking | Done: `minifyEnabled` + `shrinkResources` | Rules in `app/proguard-rules.pro`. CI builds the release variant on every push. Upload `mapping.txt` with each release (the release workflow attaches it) |
| Release lint | Done: `lintVitalRelease` in CI and release | |
| Backup | Done: `allowBackup=false` plus extraction rules | Nothing is backed up; token and DB are device-local |
| Release workflow | Done: builds, signs and verifies the APK and AAB, attaches both and the mapping to the GitHub Release | Cert fingerprint is overridable via the `EXPECTED_CERT_SHA256` repo variable |
| Automated Play upload | Done, dormant | Runs only when the `PLAY_SERVICE_ACCOUNT_JSON` secret exists; uploads the AAB as a draft to the internal track |
| Store listing text | Done: `store/en-US/` | Title, short and full description, release notes |
| Store graphics | Done: `store/graphics/` (regenerate with `tools/make-store-graphics.py`) | Icon 512 and feature graphic 1024x500. Phone screenshots are still needed |
| Data safety, FGS and permission text | Drafted: `store/data-safety.md`, `store/foreground-services.md` | Re-verify against the live forms |
| App access instructions | Drafted: `store/app-access.md` | Needs hosted sample files and/or a demo server |
| Privacy policy | Drafted: `docs/privacy-policy.md` | Fill the date and contact; host at a public URL |
| Cleartext traffic | Loopback only | Remote Jellyfin servers must use HTTPS. Plain-HTTP LAN servers do not work; mention in the listing |

### Needs you (secrets, accounts, decisions)
1. Play Console developer account, and create the app with package name above.
2. Key strategy: enroll the existing release key (cert `7d850dae...e416`) as the app-signing key on
   first upload so sideloaded and Play installs share one signature, or use a separate upload key.
   If the signing certificate differs, set the `EXPECTED_CERT_SHA256` repo variable.
3. CI secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
   `ANDROID_KEY_PASSWORD`; optionally `PLAY_SERVICE_ACCOUNT_JSON`.
4. Host the privacy policy and fill its placeholders; host sample audio or a demo server for reviewers.
5. Phone screenshots (at least 2) and, optionally, Android Auto screenshots.
6. Complete Play Console forms (Data safety, content rating, target audience, FGS declarations).
7. Run the Android Auto gate (S019), the closed test (12 testers, 14 days for personal accounts) and
   review the pre-launch report.

## 3. Data safety form: what to declare

The app has no analytics, ads, crash reporting SDKs or accounts of its own.

- **Data collected and shared with a third party (optional feature)**: when the user enables
  artwork pulling, album and artist *names* are sent to MusicBrainz / Cover Art Archive. Declare
  as "App activity / other" or "Other user-generated content", shared, optional, purpose "App
  functionality".
- **Data sent to the user's own server**: Jellyfin URL, username and access token go to the
  server the *user* configures. This is the user talking to their own infrastructure, but
  declare authentication/credential data as collected, encrypted in transit (if HTTPS), purpose
  "App functionality / account management". Re-check the current form wording.
- Data is encrypted in transit when the server uses HTTPS; users can clear it by signing out or
  uninstalling. State that no data is sold.

## 4. Pre-submission checklist

- [ ] Developer account verified; app created with the final package name
- [ ] Key strategy decided; upload key or existing key enrolled in Play App Signing
- [ ] `bundleRelease` produces a signed AAB; installs cleanly via `bundletool` on a device
- [ ] versionCode higher than anything uploaded; versionName matches the tag
- [ ] Privacy policy URL live; store listing text and graphics ready
- [ ] Data safety, content rating, target audience, app access, FGS declarations completed
- [ ] Android Auto gate (S019) passed on the Desktop Head Unit
- [ ] Internal test smoke-tested; closed test running with 12+ testers for 14 days (personal accounts)
- [ ] Pre-launch report reviewed
