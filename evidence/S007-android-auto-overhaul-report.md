# S007 — Song radio (Android + Android Auto)

Version: versionCode 8 / 0.2.7-s7 (APK SHA256 `cdc379b3ee3797d4afb2d22c2d87c03b7b40878b407a696bb51c2840418995bb`).
Note: the published v8 APK still has the clipped track context menu; the fix (menu hosted on `<body>`, bottom sheet on phones, opaque panel) lands in the next APK (v9).

## What changed
- Native: `radio/RadioScorer.kt` (artist/album/genre/year/title similarity, deterministic), `radio/RadioBuilder.kt` (Jellyfin InstantMix first, local scorer fallback), `JellyfinClient.instantMix`, `PlaybackService.playRadio`, car **Radio** folder (`radio::<trackId>`, 5 seeds), voice "play radio like X".
- Plugin: `radio(call)` -> `{trackIds, source}`; tracks carry `genre`.
- Web: `playback-core/radio.ts` (+spec), `RadioStore`, library menu "Start radio" / "Save radio as playlist".

## Evidence
- Unit: `BrowseTreeTest` (25), `RadioScorerTest`, vitest `radio.spec.ts` — pass.
- Instrumented: `MediaLibraryServiceBrowseTest` incl. `radioFolderAndVoiceBuildASimilarQueue` (7 tests) — pass.
- Emulator (Android 16): Library -> track menu -> "Start radio" on "Seed Song" -> toast "Seed Song Radio · 5 similar songs queued"; Queue tab shows Seed Song (playing), Same Band (same artist), Other Rock, Genre Mate, Odd One, Pop Tune. See `s007-radio-queue.png`.

## Not verified
- Jellyfin InstantMix path against a real server (unit-level only; emulator has no Jellyfin session).
- "Save radio as playlist" and the car Radio folder on a real head unit / DHU.
- Voice radio through a real Assistant.
