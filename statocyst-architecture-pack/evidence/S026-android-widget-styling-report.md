# S026 — widget styling to the app's design + Speed dial (1.7.0, versionCode 25)

## Styling (tokens mirrored from `apps/desktop/src/styles.scss`)
- Container: abyss gradient (#0B1A33 → #050A18), 1dp hairline `--line`, 22dp corners, cyan bloom top-left and violet bloom bottom-right.
- Text: `--text` #E9F4FF titles, `--muted` #A9C0D8 artists, cyan letter-spaced uppercase eyebrows ("NOW PLAYING" / "PAUSED" / "TOP FAVORITES" / "QUICK PICKS" / "RECENT").
- Play button: the player-bar gradient (#4CE7FF → #1F9FD8 → #7466F5) with a cyan ring and dark glyph, on every widget.
- Artwork: rounded with a hairline border; placeholder mirrors the app's artwork component (abyss gradient, cyan + violet bloom, cyan letter).
- Favorites list uses cyan ranks; heart is the app's `--danger` pink.
- Widgets are dark-only (the app's light theme is an in-app setting, not tied to system night mode).

## New: Speed dial (4x3)
Now-playing strip with prev / play / next on top; the four most recent songs (excluding the one playing) as cover tiles below; tap plays with the recents queue.

## Evidence
- `:app:testDebugUnitTest` green; `:app:connectedDebugAndroidTest`: 29 tests, 0 failures. `NowPlayingWidgetTest` now has 6 tests (adds speed dial). The test caught `View` not being allowed in RemoteViews (dividers are `ImageView`s).
- Snapshots inspected: playing, idle, large, compact, quick picks, speed dial.
- Release 1.7.0 published; local = public SHA-256 `54718cc9601beb217a15bcdc0d63dd216b8d0d8203326e631bc02347d312e8e9`; installed on the emulator.

## Not verified
Placement on a real launcher and real cover art; system fonts only (Space Grotesk/Inter are not bundled).
