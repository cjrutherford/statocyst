# S028 — Speed dial = playback + history + favorites (1.9.0, versionCode 27)

Speed dial is the player strip (cover, title/artist, prev / play / next, state label) above a scrolling 4-column cover grid of history and favorites:
- Both exist → interleaved, history first, deduped; only one kind → only that kind; neither → hint.
- The song playing now is shown in the strip and left out of the grid.
- Grid label follows content ("History & favorites" / "Favorites" / "History"); tapping a cover plays it with its list queued.

## Evidence
- Unit tests green; connected tests: 31, 0 failures (run before publishing). Added: current song excluded from the grid; the real-`AppWidgetHost` test now also asserts the player controls and its snapshot (`widget-dial-host.png`) shows player + grid populated by `SpeedDialService`.
- Release 1.9.0 published; local = public SHA-256 `c8001381a16c3db2f8694915dfd39ba6af4fbc16aef3e3934355471ad078b246`; installed on the emulator.

## Not verified
Launcher tap-through and real cover art.
