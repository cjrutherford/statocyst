# Car surfaces: shared recommendation snapshot

**Status:** Phases 1–6 implemented. Android Auto/CarPlay data paths and the AAOS
Compose surface compile; the AAOS surface is verified on a real Android Automotive
OS emulator. CarPlay’s Swift changes still need a macOS/Xcode build and a real
entitlement before they can be called verified.

## Why a snapshot

Android Auto, CarPlay and Android Automotive OS do not run the Angular WebView. The
recommendation engine stays in the renderer and publishes a small, versioned snapshot;
native surfaces only resolve catalog ids and draw the host UI.

```text
Angular recommender
  → buildCarRecommendationSnapshot()
  → syncUserState({ favorites, playlists, carRecommendations })
  → Android SharedPreferences / iOS app_state
  → BrowseTree (Android Auto) / CarPlay templates / AAOS Compose
```

`CarRecommendationSnapshot` and `CarMix` live in
[`libs/contracts/src/lib/car.ts`](../libs/contracts/src/lib/car.ts). The four mixes are
produced in [`libs/recommendation/src/lib/car-mixes.ts`](../libs/recommendation/src/lib/car-mixes.ts):

| Mix | Rule |
| --- | --- |
| Daily drift | Top local recommendations from favorites, recency and metadata |
| Rediscover | Favorites or tracks last played more than 30 days ago |
| Deep cuts | Candidates explained by artist/album affinity |
| Favorites radio | Favorites ordered by the current ranking |

The first mix is the default “For you” list. Empty mixes are omitted.

## Android Auto

- `BrowseIds.FOR_YOU` is the first root folder when a snapshot exists.
- It uses a grid child style; each mix is a grid tile and opens a track list.
- Track subtitles carry `artist · reason`, so the host renders the explanation.
- `CarArt` generates square sonar-ring tiles for the root folders and each mix in the app
  cache and exposes them through `LocalMediaServer`.
- The snapshot is stored in the existing `statocyst` SharedPreferences store under
  `car_recommendations`, so no Room migration is required.
- Android Auto remains system-rendered. The theme is carried by the tile artwork and copy,
  not by app colors or fonts.

## CarPlay

- “For you” is the first tab. Mixes use `CPGridTemplate`; `CarPlayArtwork.mixTile` draws
  the cyan/violet sonar tiles.
- Tapping a mix pushes a `CPListTemplate` with one row per track and the reason in the
  detail line.
- Track rows now load artwork asynchronously from the same local/Jellyfin resolver used by
  Now Playing.
- The snapshot is decoded from `app_state` in `CarPlaySceneDelegate`; an empty or stale
  snapshot shows a “For you is warming up” row instead of a dead tab.
- CarPlay reads the snapshot when the scene connects. Live replacement while a mix is
  open is intentionally deferred: resetting the root template mid-drive is worse than
  refreshing on the next connection.
- CarPlay remains system-styled. The artwork is the branding surface.

## Android Automotive OS

The embedded OS surface is a real Compose app, not a template. `AutomotiveActivity`
uses the same local Room catalog, `PlaybackService` Media3 session and
`car_recommendations` snapshot, but draws the phone design system directly.

- `MainActivity.load()` checks `PackageManager.FEATURE_AUTOMOTIVE` and launches the
  automotive activity instead of the Capacitor WebView. Phones keep a single launcher icon.
- The surface has **For you**, **Library**, **Favorites** and **Radio** destinations.
- For you shows the four mix tiles, a recently played list, and a persistent Now Playing
  panel with artwork, progress, transport, favorite and up-next.
- Mix playback uses the existing `BrowseIds.carMix(...)` context; Radio uses the existing
  native `RadioBuilder` path. No queue or playback logic is duplicated.
- Saving and editing remain phone-only.
- A debug-only manifest exports the activity so a normal emulator can launch it with
  `adb shell am start -n <package>/.automotive.AutomotiveActivity`; release keeps it
  non-exported.

Runtime status: debug and release builds pass, and the surface is verified on the
Android Automotive OS emulator (see below) with seeded tracks, four mixes, real Media3
playback, the driving banner, the offline banner and the stale-snapshot banner. The
phone WebView path was re-checked after adding `useLibrary 'android.car'` and Compose.

### Driving and connectivity hardening

- `useLibrary 'android.car'` gives the automotive module `CarUxRestrictionsManager`.
  The monitor is only constructed by the AAOS surface; phones never load `android.car`.
- When the car reports `isRequiresDistractionOptimization`, AAOS shows a driving banner
  and limits Library/Favorites/Radio/Recently played to six rows. Playback, mixes,
  radio, favorite and the now-playing bar remain available.
- Debug builds can simulate the driving state:
  ```bash
  adb shell am start -n \
    com.hopefulaspirationsindustries.statocyst/com.hopefulaspirationsindustries.statocyst.automotive.AutomotiveActivity \
    --ez force_driving true
  ```
  Release builds ignore the extra.
- A `ConnectivityManager` callback plus a one-second fallback check drives the offline
  banner. The local catalog and car snapshot still work offline.
- `CarRecommendations` keeps the snapshot’s `generatedAt`. Snapshots older than 24 hours
  are marked stale:
  - AAOS shows “Mix may be out of date · open Statocyst on your phone to refresh”.
  - Android Auto replaces the For you folder subtitle with “Open Statocyst on your phone
    to refresh”.
  - CarPlay keeps the last grid and refreshes on the next connection.

### AAOS verification recipe

Command-line tools are installed at
`$ANDROID_HOME/cmdline-tools/latest`. The working image is:

```bash
sdkmanager \
  "system-images;android-35-ext15;android-automotive-playstore;x86_64"

echo no | avdmanager create avd \
  -n StatocystAAOS \
  -k "system-images;android-35-ext15;android-automotive-playstore;x86_64" \
  -d automotive_1024p_landscape

emulator -avd StatocystAAOS -no-window -no-audio -no-snapshot \
  -gpu swiftshader_indirect
```

The same install/create/boot flow is wrapped in
[`tools/aaos-emulator.sh`](../tools/aaos-emulator.sh).

The emulator ran as the `Driver` user (user 0 for `run-as` fixtures). Install the debug
APK, launch `net.christopherrutherford.statocyst.MainActivity`, and confirm it hands off to
`AutomotiveActivity`. Use `tools/android-seed-fixtures.py --demo` plus the AAOS snapshot
fixture to populate the car surface.

### Play automotive review path

Before submitting an automotive build:

- Keep `android:appCategory="audio"` and `xml/automotive_app_desc.xml` with
  `<uses name="media" />`.
- Re-run the distraction checks on a real automotive image/head unit:
  restricted driving state must not expose unbounded lists, text entry, video or setup
  flows.
- Verify the release build is non-exported for `AutomotiveActivity` and that the debug
  export does not ship.
- Complete Play Console automotive review with the privacy policy, content rating and
  screenshots of the driving-optimized surface.
- Keep the AAOS surface and the projected Android Auto/CarPlay browse tree on the same
  snapshot and catalog schema.

## Native fallback ranking

The car surfaces no longer depend on the phone WebView to have run before For you
works. A fresh snapshot still wins; a missing, malformed or stale snapshot falls back
to a native ranking over the local catalog, favorites and recent plays. Android Auto
and AAOS use `CarRecommender.kt`; CarPlay uses `CarPlayRecommender` in
`CarPlayBrowse.swift`.

The exact weights, mix rules, fixture and divergence policy are in
[`car-recommender.md`](car-recommender.md). The AAOS fallback was verified cold-start
on the automotive emulator with the `car_recommendations` preference removed.

## Phone-only actions

Selecting songs, naming a mix and saving a playlist stay in the Angular app. The car
surfaces expose play, radio, queue and favorite only.

## Verification

- `libs/recommendation` tests build the four mixes deterministically and omit missing
  tracks/empty mixes.
- Android unit tests cover root ordering, For you children, reason subtitles, mix context
  playback and malformed snapshot rejection.
- Android build/tests run with JDK 21 from Android Studio’s JBR:
  `JAVA_HOME=/opt/android-studio/jbr ANDROID_HOME=$HOME/Android/Sdk ./gradlew testDebugUnitTest`.
- CarPlay/AAOS still need their own gates: macOS/Xcode plus entitlement for CarPlay, and
  an Automotive OS emulator plus Play automotive review for AAOS.

## Next

Android Automotive OS gets the full custom Compose surface, reading the same Room catalog,
playback service and snapshot. It is the only surface where the phone’s actual glass,
typography and cyan/violet palette can be used unchanged.
