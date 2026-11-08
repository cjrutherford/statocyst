# Evidence report: S046 — Two-context playback, resume, speed and skip

**Status:** IMPLEMENTED_UNVERIFIED (service integration + desktop podcast E2E verified; full restart/completion device gates pending S053)
**Date:** 2026-11-08
**Depends on:** S042

## Landed

### Contracts

- `PlaybackContext = music | podcast`.
- `PlaybackSnapshot` and `QueueSnapshot` carry `context` and `active`.
- `PlaybackSnapshot.rate`; `PlaybackCommand.setRate` (0.5–3).
- `EngineLoadRequest.playbackRate` and `EngineCommand { action: 'rate' }`.
- JSON schema and valid/invalid/event fixtures updated in lockstep.

### Authoritative service

- `PlaybackService` now holds two persisted `ContextState` values (queue, state, position,
  duration, loaded entry) and exposes them through active-context getters, so music
  behavior stays the same.
- One active context drives the engine. `switchContext` pauses the outgoing context,
  persists both states, emits `stateChanged`/`queueChanged` for the outgoing context with
  `active: false`, loads the incoming current entry paused, then applies the command.
- Queue-only commands (`enqueue`, `playNext`, `remove`, `reorder`, `setShuffle`,
  `setRepeat`, `clear`) against an inactive context mutate and persist that queue without
  switching audio.
- `init` restores both queues, both playback positions, the active context, rate and
  shuffle/repeat; `syncLibrary` prunes and emits both contexts.
- Podcast queue entries are mapped between `media_item` playback ids and
  `podcast_episode` ids when loading/saving, so the queue model keeps one track id shape.
- Podcast resume is written on pause/seek/switch/track change/shutdown and on the debounced
  persist path; completion marks the episode played/completed and advances. Starting a
  podcast episode writes play count/last-played only when listening history is enabled.
- `setRate` is podcast-only; the rate survives track changes within the context.
- `getSnapshot`/`getQueue`/`command` accept a context; the IPC layer defaults to music so
  existing music callers keep their behavior.
- `protocol.ts` remote media is now a union: Jellyfin (token/quality) or podcast (enclosure
  URL). Podcast streams proxy Range, follow one redirect without credentials, and
  revalidate the enclosure URL in `main.ts`.
- Artwork resolution prefers a cached local path before a remote Jellyfin image, so
  podcast artwork is not diverted to `proxyRemoteArt`.

### Renderer

- Audio engine applies `playbackRate` on load and `rate` commands.
- `PlaybackStore` ignores events from the podcast context and only applies positions while
  music is active; it exposes `setRate`.
- New `PodcastPlaybackStore` mirrors the podcast context, always addresses it explicitly,
  and supports play, toggle, seek, skip, rate, enqueue and queue removal.
- Full player-bar/Now Playing podcast layout remains S045; the store is ready for it.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec tsc-rs --noEmit -p libs/contracts/tsconfig.json` | exit 0 |
| `pnpm exec tsc-rs --noEmit -p libs/persistence/tsconfig.json` | exit 0 |
| `pnpm exec tsc-rs --noEmit -p apps/desktop-electron/tsconfig.json` | exit 0 |
| `pnpm exec tsc-rs --noEmit -p apps/desktop/tsconfig.json` | exit 0 |
| `pnpm exec vitest run --config apps/desktop-electron/vitest.config.ts` | 47 passed, 2 skipped |
| `pnpm exec vitest run --config libs/contracts/vitest.config.ts` | 9 passed |
| `pnpm exec vitest run --config libs/persistence/vitest.config.ts` | 24 passed |
| `pnpm exec vitest run --config libs/playback-core/vitest.config.ts` | 38 passed |
| `node tools/build-electron.mjs` | exit 0, main 415.9 kB |

Focused S046 integration tests:

- switch music → podcast → music; both `track` snapshots remain, music becomes active and
  podcast becomes inactive;
- podcast position 20 s is written to `podcast_episode.resume_position_ms`, and a reopened
  service restores both queues and the podcast position;
- enqueuing an episode into the inactive podcast queue does not switch audio;
- `setRate` applies to podcast, reaches the engine as a `rate` command, and is rejected for
  music;
- an episode that ends is marked played/completed and the next episode loads.

Logs:

- `/tmp/statocyst-s046-playback-test.log`
- `/tmp/statocyst-s046-electron-test.log`
- `/tmp/statocyst-s046-electron-tsc.log`
- `/tmp/statocyst-s046-electron-build.log`

## Not verified / next

- No Playwright/UI E2E yet; S045 builds the podcast views/player bar and S053 runs the
  desktop switch → resume → completion E2E.
- Android/iOS native context switching, rate and resume are S049/S051.
- Downloads/cache for podcast remote media are S047; the media protocol already streams an
  enclosure, but pinned offline playback is not wired.
