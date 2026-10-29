# S027 — Speed dial as a rolling history + favorites list (1.8.0, versionCode 26)

Speed dial is now only a scrolling 4-column grid of covers (no player strip):
- Both history and favorites exist → interleaved (history first), a song in both lists shown once.
- Only favorites → favorites only. Only history → history only. Neither → empty hint.
- Header label follows the content: "History & favorites" / "Favorites" / "History".
- Backed by a real collection adapter (`SpeedDialService`, `RemoteViewsFactory`), up to 24 covers; tapping one plays it with its list (history → recents, favorites → favorites) queued around it.

## Evidence
- `:app:testDebugUnitTest` green; `:app:connectedDebugAndroidTest`: 31 tests, 0 failures. New tests: mix/label rules for all four cases; item rendering + factory reading the real library; and a test that registers the widget on a real `AppWidgetHost`, lets the platform bind `SpeedDialService`, and checks the grid fills (snapshot `widget-dial-host.png` inspected).
- Release 1.8.0 published; local = public SHA-256 `e5d4370c5e39c15c3b41c521ad6630b95a42fe1543aa89427ef2290dd455e655`; installed on the emulator.

## Not verified
Tap-through from a launcher-hosted tile and real cover art.
