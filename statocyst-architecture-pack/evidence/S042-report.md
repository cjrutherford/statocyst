# Evidence report: S042 — Podcast contracts, schema and migrations

**Status:** IMPLEMENTED_UNVERIFIED (desktop + Android verified; iOS build BLOCKED)
**Date:** 2026-11-08
**Branch:** worktree (current)
**Depends on:** —

## Landed

### Contracts

- `MediaKind` (`music | podcast`) and `PlaybackContext` (`music | podcast`) in
  `libs/contracts/src/lib/playback.ts`.
- Optional `Track.mediaKind`; language-neutral schema accepts `music`/`podcast` and rejects
  other values.
- New `libs/contracts/src/lib/podcast.ts`: `PodcastFeed`, `PodcastEpisode`,
  `PodcastFeedPatch`, `PodcastSearchResult`, refresh/import summaries, change events and
  the optional `PodcastBridge` surface.
- `PlaybackBridge` now accepts an optional playback context on snapshot/queue/command.
  Runtime routing lands in S046.

### Desktop libSQL migration 6

- `media_item.media_kind` (default `music`, indexed), `playback_state.active_context`
  (default `music`).
- `podcast_feed`, `podcast_episode`, `podcast_queue_entry`, `podcast_playback_state`,
  `podcast_directory_cache` with the planned indexes.
- `media_source.kind` extended to `podcast` by rebuilding the small source table.
- **Finding:** the first rebuild attempt deleted media rows because `media_item.source_id`
  references `media_source` with `ON DELETE CASCADE`; `PRAGMA defer_foreign_keys` did not
  protect the implicit parent delete.
- **Fix:** `Migration.foreignKeysOff` scopes `PRAGMA foreign_keys = OFF` around migration 6
  only; the runner restores enforcement in `finally`. The v5-fixture test proves all music,
  queue, playback, download and Jellyfin rows survive, with zero FK violations.

### Persistence repository

- `mediaKind` on stored tracks; `listTracks()` is music-only and `listAllTracks()` serves
  playback later. Music stats filter `media_kind = 'music'`.
- `refreshMissing` skips podcast episodes (remote enclosures), matching Jellyfin.
- Deterministic `podcast` media source, feed upsert/settings/removal, transactional episode
  save (media item + episode), episode listing/get/played/resume, podcast queue, podcast
  playback state, orphan cleanup, and stable `podcast:<sha256(feedUrl + NUL + guid)>`
  media path keys.

### Android

- `MediaItemEntity.mediaKind` (Room default `music`).
- Room v7 entities/DAO for feeds, episodes, queue, playback state and directory cache.
- `MIGRATION_6_7` creates the tables/indexes and adds `mediaKind`.
- Music listing, stats, radio and plugin track JSON filter/expose `mediaKind`.
- New instrumented `PodcastMigrationTest` opens a real v6 SQLite file through Room with
  only `MIGRATION_6_7`; it verifies the media row survives as `music`, the download
  survives, and all podcast tables exist empty.

### iOS

- `MediaItemEntity.mediaKind`, schema 6, podcast tables/indexes, idempotent column add for
  existing databases, read/write/bind column 32, and `mediaKind` in the plugin track dict.
- Music listing, stats, radio and CarPlay browse filter `mediaKind == "music"`.

## Commands and results

All commands from the repository root unless noted.

| Command | Result |
| --- | --- |
| `pnpm exec tsc-rs --noEmit -p libs/contracts/tsconfig.json` | exit 0 |
| `pnpm exec tsc-rs --noEmit -p libs/persistence/tsconfig.json` | exit 0 |
| `pnpm exec tsc-rs --noEmit -p libs/playback-core/tsconfig.json` | exit 0 |
| `pnpm exec tsc-rs --noEmit -p libs/media-library/tsconfig.json` | exit 0 |
| `pnpm exec tsc-rs --noEmit -p apps/desktop/tsconfig.json` | exit 0 |
| `pnpm exec tsc-rs --noEmit -p apps/desktop-electron/tsconfig.json` | exit 0 |
| `pnpm exec vitest run --config libs/contracts/vitest.config.ts` | 9 passed |
| `pnpm exec vitest run --config libs/persistence/vitest.config.ts` | 24 passed |
| `pnpm exec vitest run --config libs/playback-core/vitest.config.ts` | 38 passed |
| `pnpm exec vitest run --config libs/media-library/vitest.config.ts` | 11 passed |
| `pnpm exec vitest run --config apps/desktop-electron/vitest.config.ts` | 35 passed, 2 skipped |
| `./gradlew :app:compileDebugKotlin` (JDK 21, Android SDK 36) | BUILD SUCCESSFUL |
| `./gradlew :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=net.christopherrutherford.statocyst.db.PodcastMigrationTest` (Medium_Phone_API_36.1 AVD) | 1 passed |
| iOS schema SQL replay (libSQL, v5 file + `mediaKind` ALTER + podcast tables) | `mediaKind=music`, episode insert ok, 0 FK violations |
| `xcodebuild` | **BLOCKED:** macOS/Xcode not available in this environment |

Logs:

- `/tmp/statocyst-s042-contracts-test.log`
- `/tmp/statocyst-s042-persistence-test.log`
- `/tmp/statocyst-s042-android.log`
- `/tmp/statocyst-s042-android-migration-test.log`
- `/tmp/statocyst-s042-*-tsc.log`
- `/tmp/statocyst-s042-electron-test.log`

## Not verified / next

- iOS Swift compilation and on-device schema migration remain blocked by the missing macOS
  toolchain; S053 must run the iOS build in CI or record the exact external blocker.
- No podcast UI, fetcher, parser or playback wiring is present in this slice (by design).
- The Android migration test uses a v6 SQLite fixture built from the entity schema; S053
  should also replay a real installed-app v6 database if one is available.

## Evidence decision

Desktop and Android meet the S042 gate. iOS SQL is validated but the build is not run, so
the slice remains `IMPLEMENTED_UNVERIFIED` rather than VERIFIED until the iOS build gate is
cleared.
