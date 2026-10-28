# S012 — Resume position + large queues (gap-closure slice 12)

Version: versionCode 13 / 0.3.2. Date: 2026-10-28.
APK: https://nirvana.tail5a4a0.ts.net/statocyst-android-debug.apk
SHA256: `17904d4a542afd288e61962b242594ed9214993f8aa5faef6b12047d041ee1ee`

## Changes
- **Position persistence.** While playing, `PlaybackService` saves index + position every 5 s via the new
  `QueueStore.savePosition` (does not rewrite the queue). A killed process now resumes within ~5 s, not at the last
  pause/seek/track change.
- **Large queues.** "Play from here" still queues a bounded window (50 before / 250 after) so one tap never ships
  thousands of items over Binder. The rest of the context is kept as a `ContextTail`; when playback comes within 25
  items of the end (or at any transition while shuffle is on) the next 250 are appended. A tail is dropped if the queue
  no longer ends at its anchor slot (queue was replaced or edited), so it can never append into a different queue.
- **Radio perf bug found by the 700-track fixture.** `RadioScorer.diversify` was O(n²) and rebuilt a `Regex` on every
  `norm()` call; a radio on a large single-artist library never finished. Now linear in practice (stops at the limit,
  caches normalized artists, constant regex). A 20,030-track library builds a 50-track radio in well under 5 s (unit test).

## Verification
- Unit tests: 44/44 (new: `ContextTailTest` x4, large-library radio test).
- Instrumented on emulator-5554 (Android 16): 10/10 (new: `largePlaylistQueuesAWindowThenExtendsAsPlaybackAdvances`
  with a 700-track playlist: 251 queued, then 501 after seeking near the end; `QueueStoreTest` x2).
  Service log: `play zz-fix-001 from playlist::zz-big: 251 queued`, `context extended by 250; 199 left`.
- Published APK verified: local and public SHA256 match, versionCode 13.

## Not verified
- Resume after a real process kill during playback on a device (the position write is covered at the store level only).
- Behaviour with a real 5,000+ track library or Jellyfin tracks (extension resolves each slot via `resolveItem`, which
  for Jellyfin does not hit the network).
- Shuffle order is still not persisted; restore keeps the shuffle flag but ExoPlayer reshuffles.
