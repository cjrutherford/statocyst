# S025 — YouTube-Music-style widget set (1.6.0, versionCode 24)

Replaces the single basic list widget with four home-screen widgets sharing one renderer (`Widgets`):

| Widget | Size | Content |
|---|---|---|
| Player + favorites (`NowPlayingWidget`) | 4x3 | cover, title/artist, prev/play/next, top 4 favorites (tap plays, favorites queued) |
| Now playing (`NowPlayingLargeWidget`) | 4x2 | big cover, title/artist, heart toggle, prev / round play / next |
| Now playing slim (`NowPlayingCompactWidget`) | 4x1 | small cover, title/artist, prev/play/next |
| Quick picks (`QuickPicksWidget`) | 4x3 | grid of up to 8 cover tiles: recent listening (one per album), topped up with favorites; tap plays with that list queued |

- Artwork: rounded-square bitmaps from the same resolver as the app (external art override, Jellyfin fallback); lettered colored placeholder when none (`WidgetArt`, LRU cache).
- Tile taps: `WidgetActionReceiver.ACTION_PLAY_TRACK` with a browse context (`recents` / `favorites`), expanded by the service into the folder queue. Heart: `ACTION_TOGGLE_FAVORITE` toggles the current song and refreshes every widget.
- Transport buttons go through Media3's `MediaButtonReceiver`, so they work after the process is gone.

## Evidence
- `:app:testDebugUnitTest` green; `:app:connectedDebugAndroidTest`: 28 tests, 0 failures (emulator-5554, Android 16).
- New `NowPlayingWidgetTest` (5 tests): list render, large/compact render + favorite state, quick-pick ordering/dedupe/empty state, tile tap plays + queues the list via the real service, heart toggles favorite state. Snapshots rendered and inspected (`widget-{playing,idle,large,compact,picks}.png`).
- Release 1.6.0 published; local and public SHA-256 `a82b476f96ef452f6000671fe481eebdf89a6495f3b1ed106da176eb792655d6`; installed on the emulator.

## Not verified
- Placement on a real launcher and real cover art (snapshots use placeholders); picker previews use the layouts with default text.
