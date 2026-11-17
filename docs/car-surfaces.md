# Car surfaces: shared recommendation snapshot

**Status:** Phases 1–4 implemented in the shared renderer and Android Auto/CarPlay
data paths. Android compiles and unit tests pass; CarPlay’s Swift changes need a
macOS/Xcode build and a real entitlement before they can be called verified.

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

Runtime status: debug and release builds pass, and the surface was launched on an API 36
phone emulator with seeded tracks, four mixes and real Media3 playback. A real Android
Automotive OS image or head unit is still required for the automotive gate.

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
