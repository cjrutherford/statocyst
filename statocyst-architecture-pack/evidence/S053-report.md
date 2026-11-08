# Evidence report: S053 — Cross-platform podcast verification and release gate

**Status:** BLOCKED (desktop + Android core verified; iOS/CarPlay gates unresolved)
**Date:** 2026-11-08
**Depends on:** S045, S047, S049, S051, S052

## Verification performed

| Command | Result |
| --- | --- |
| `tsc-rs` for contracts, playback-core, persistence, media-library, podcast-core, jellyfin-client, desktop, desktop-electron | all exit 0 |
| `vitest` contracts | 9 passed |
| `vitest` playback-core | 38 passed |
| `vitest` persistence | 24 passed |
| `vitest` media-library | 11 passed |
| `vitest` podcast-core | 20 passed |
| `vitest` desktop-electron | 48 passed, 2 skipped |
| `nx build desktop --skip-nx-cache` | success |
| `node tools/build-electron.mjs` | success |
| `./gradlew :app:compileDebugKotlin :app:testDebugUnitTest` | BUILD SUCCESSFUL |
| Android `PodcastMigrationTest` (emulator) | 1 passed |
| Android `PodcastRepositoryTest` (emulator) | 2 passed |
| Playwright full suite | 6 passed, 2 failed |
| Playwright `e2e/podcasts.spec.ts` | 1 passed |

### Playwright failures

Both failures are pre-existing Settings-tab expectations recorded in S041/S040, not podcast
regressions:

- `desktop.spec.ts` expects “Database healthy” on the default Settings tab, but diagnostics
  live behind the Diagnostics tab.
- `privacy.spec.ts` expects the “Server URL” field on the default Settings tab, but Jellyfin
  lives behind its own tab.

The podcast flow, a11y suite, phone Now Playing and the rest of the desktop suite pass.

## What is verified

- RSS/Atom/OPML parsing (OPML remains a parser diagnostic only), hostile-input rejection,
  URL safety and stable identity.
- Desktop discovery through keyless Apple/Fyyd search, refresh/304, artwork cache, podcast
  queue/resume/rate/completion, downloads and offline pin playback.
- Desktop UI subscription, episode list, show notes, play, mark played, player-bar podcast
  mode, settings, unsubscribe and cached artwork, including the local-server-offline pin.
- Android Room v6→v7 migration, native podcast persistence, encrypted credentials, direct
  enclosure resolution, Media3 rate and renderer context split (build/unit only).
- Android emulator discovery landing: real Apple top-podcast chart, 27 source-derived
  categories, category results, one-tap subscribe, and real cover artwork in the grid,
  episode rows, show detail and now-playing bar. Live provider search/feed fetch confirmed;
  physical-device background/airplane-mode evidence is still pending.
- Music behavior remains green across the existing suites.

## Blocking gaps for the release gate

1. **iOS data/ingestion (S050):** BLOCKED — no macOS/Xcode; no Swift transport/repository
   or plugin methods.
2. **iOS playback/downloads (S051):** BLOCKED — depends on S050.
3. **Android Auto / CarPlay podcast browse (S052):** BLOCKED — no native podcast browse
   nodes and no CarPlay implementation/entitlement run.
4. **Physical Android evidence:** only the emulator was run for migrations, persistence and
   credentials; no screen-off, process-death or airplane-mode podcast run.
5. **Live directory providers:** the service test uses injectable Apple/Fyyd provider bases;
   a final live-provider run should record Apple/Fyyd response success and rate-limit behavior.
6. **Performance gate:** 100 subscriptions / 10,000 episodes was not measured.
7. **A11y for the podcast screen:** the global a11y suite passes, but it does not yet
   navigate the Podcasts view; add a podcast-specific audit.

## Release decision

**MVP-5 is NOT released.** Desktop and Android podcast core are implemented and largely
verified, but the all-platform gate in `roadmap/PODCASTS.md` §18 is not met. Do not claim
“podcasts on all platforms” until S050–S052 are implemented and evidenced on macOS/Android
hardware.

Review artifacts produced after this verification:

- `release/statocyst-android-2.0.0-podcast-test.apk` (signed release APK)
- `release/statocyst-2.0.0-linux-amd64.deb`
- `release/statocyst-2.0.0-mac-arm64.zip` / `statocyst-2.0.0-mac-x64.zip` (unsigned
  Electron desktop builds)
- hashes and install notes in `evidence/PACKAGING-podcast-test.md` and
  `release/statocyst-macos-testing.md`

The macOS zips are for independent desktop verification only; they are not an iOS build.

Recommended next actions, in order:

1. Run this branch on macOS; implement S050/S051 using the S048/S049 pattern and the
   reproduction recipes in their reports.
2. Add Android Auto podcast browse nodes and run the DHU/phone matrix.
3. Run a physical Android podcast test (background, process death, airplane mode) and a real
   live Apple/Fyyd provider run.
4. Add the 100-feed/10k-episode performance fixture and a Podcasts-specific a11y run.
5. Fix the two pre-existing Settings-tab E2E expectations in the same verification pass.

## Evidence bundle

- S042–S049 reports and logs under `statocyst-architecture-pack/evidence/`.
- `evidence/screenshots/s045-podcasts.png`.
- `/tmp/statocyst-s053-typecheck.log`
- `/tmp/statocyst-s053-e2e.log`
- `/tmp/statocyst-s045-e2e.log`
- `/tmp/statocyst-s047-e2e.log`
- `/tmp/statocyst-s048-android-test.log`
- `/tmp/statocyst-s049-android.log`
