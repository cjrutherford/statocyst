# Recently played and the first recommendation slice

**Status:** shared renderer implemented and exercised on Electron; Android compiles and its
migration test runs on an API 36 emulator; iOS Swift is not compiled in this Linux
environment.

## Recently played

The Playlists screen replaced “Recently added” with “Recently played” and moved it below
Saved playlists. The list is newest first and is derived from the host’s local listening
history:

| Platform | Source |
| --- | --- |
| Electron | `media_item.last_played_at` and `play_count` in the local libSQL database |
| Android | Room `recent.playedAt` / `recent.playCount`, folded onto the visible row for duplicates |
| iOS | SQLite `recent.playedAt` / `recent.playCount`, written when playback actually starts |

All three hosts now record both the last start and an accumulating local play count, so
the recommendation model receives the same behavioral signals everywhere. A pause, seek
or queue restore is not a new play.

Recording remains opt-in through **Settings → Privacy → Save local listening history**
(ADR-015). Turning it off stops new writes; existing plays stay visible and can still be
used to build playlists.

Users can select rows in the history and save them as a playlist, or save the whole
history in one action. A play that starts while the app is open updates the list without
reloading the library catalog.

## Recommendation slice

`libs/recommendation` is the first explainable, local recommender. It is deliberately a
subset of ADR-005, not the finished Statolith engine:

- **Signals:** explicit favorites, recency-weighted listening history, play counts where
  the host records them, and metadata similarity to recent or explicitly selected seeds.
- **Ranking:** additive scores with a small deterministic jitter, plus a per-artist cap to
  keep a mix from becoming one artist’s album. Songs heard in the last 12 hours stay in
  Recently played instead of repeating at the top of the mix.
- **Explanation:** every result carries its strongest reasons (`favorite`,
  `artist-affinity`, `genre-affinity`, `album-affinity`, `seed-similarity`, `rediscover`,
  `discovery`) and a confidence band.
- **Privacy:** everything runs in the renderer against local rows. No acoustic analysis,
  embedding service, network call or server reporting is involved.

The “For you” section on the Playlists screen uses the newest recent plays as implicit
seeds and exposes the first explanation for each track. Selecting songs in the history and
choosing **Mix from selected** turns that selection into explicit seeds instead. Saving the
mix creates a normal local playlist.

## Explicitly deferred

- Acoustic feature extraction and vector embeddings.
- Cross-device recommendation profiles or preference-vector sync.
- Global music + podcast ranking.
- Any upload, telemetry or server-side training.

Those require the intelligence milestone gates in the architecture pack and additional
ADR evidence before they can be promoted.
