# S005 — Head-unit controls, voice search, resumption

Build: versionCode 6 / 0.2.5-s5. Published APK SHA256 `b69dbff2025df83a00585428be5076a0154deb491913530734c0dd131eee83fc`.

## Delivered
- Custom buttons (shuffle, repeat OFF→ALL→ONE, favorite) via `setMediaButtonPreferences`, refreshed on state change.
- Next/previous/seek follow the context queue (windowed 50 before / 250 after).
- Voice: `onSearch`, `onGetSearchResult`, and Assistant-style `onSetMediaItems` with `searchQuery`; blank query shuffles favorites + recents (or all tracks).
- `onPlaybackResumption` plus `MediaButtonReceiver` in the manifest.
- Favorites sync both ways between Room (authoritative once seeded) and the WebView.

## Verified
- Gradle unit tests pass; vitest 70/70.
- Instrumented tests 6/6 on emulator-5554 (Android 16): root hints, paging, favorites/playlists/notify, playlist play + queue jump, car buttons, search + voice.
- `dumpsys media_session` shows custom actions Shuffle, Repeat, Favorite while PLAYING a seeded track.
- Force-stop then `KEYCODE_MEDIA_PLAY`: service restarts and resumes the saved queue (PLAYING, Test Tone).
- Screenshot: `evidence/screenshots/s005-library.png`.

## Not verified
- No Desktop Head Unit / real head unit run: custom-button rendering and the launcher icon are unconfirmed.
- Emulator has no Jellyfin session (wiped in S4); only a seeded local track was exercised.
- Resumption restores the queue; it does not restore the playback position.
- Playback URLs still carry `api_key` (slice 6). Plugin `io{}` swallows exceptions (slice 6).
- Note: LocalMediaServer only serves files under `files/{downloads,cache,library}`; the test fixture had to live in `library/`.
