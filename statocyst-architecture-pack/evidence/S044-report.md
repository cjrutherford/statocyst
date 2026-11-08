# Evidence report: S044 — Desktop podcast ingestion, refresh and discovery

**Status:** IMPLEMENTED_UNVERIFIED (local host matrix + real feed parse verified; real Podcast Index API not exercised)
**Date:** 2026-11-08
**Depends on:** S042, S043

## Landed

### Feed fetching and discovery

- `FeedFetcher` in the Electron main process:
  - conditional GET (`If-None-Match`/`If-Modified-Since`) and 304 handling;
  - manual redirect following with revalidation of every hop;
  - 15 s/30 s timeouts, 5 MiB body cap, content-type allowlist;
  - DNS resolution + private/loopback/link-local/metadata/CGNAT blocking, with an
    explicit local-network setting for self-hosted feeds;
  - truthful Statocyst user agent.
- Site autodiscovery parses `<link rel="alternate" type="application/rss+xml|atom+xml">`
  and reports multiple candidates to the log.
- Feed artwork is fetched through the same URL guard, capped at 2 MiB, cached under the
  artwork directory; episode `media_item.artwork_path` falls back to the feed image.

### Podcast library service

- `PodcastService`:
  - add feed → fetch → shared parse → transactional feed/episode persistence;
  - manual and due refresh with success/failure state, jittered exponential backoff and a
    24-hour cap;
  - 3-feed concurrency, per-feed error isolation;
  - start/launch scheduler (15-minute due check, optional refresh-on-launch);
  - per-feed settings update with range validation;
  - played/complete/unplayed state;
  - directory search over keyless Apple Podcasts (iTunes Search) and Fyyd, with
    normalization, feed-URL dedupe, source labels, partial-provider failure and a 15-minute
    cache;
  - optional Podcast Index results only when developer/environment credentials are present.
- `PodcastIndexClient` with SHA-1 request signing and typed results.
- Directory key/secret are encrypted with the existing OS-backed `TokenCodec` and stored
  only as ciphertext in `app_state`; they never appear in logs or the support settings
  snapshot. If secure storage is unavailable, search is refused rather than stored in
  plaintext.
- New settings: `podcastAllowLocalNetwork` (default false) and
  `podcastRefreshOnLaunch` (default true), persisted by the desktop settings service.
- Repository additions: fetch-state update, due-feed query, directory cache, app-state
  removal.

### Bridge and host wiring

- New `podcast:*` IPC channels and preload `podcast` bridge methods.
- `main.ts` constructs the service with the shared fetcher, directory client and settings
  getters, streams `podcast:changed` events, starts the scheduler and stops it on shutdown.
- `tools/build-electron.mjs` aliases `@statocyst/podcast-core`.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec tsc-rs --noEmit -p apps/desktop-electron/tsconfig.json` | exit 0 |
| `pnpm exec tsc-rs --noEmit -p apps/desktop/tsconfig.json` | exit 0 |
| `pnpm exec tsc-rs --noEmit -p libs/contracts/tsconfig.json` | exit 0 |
| `pnpm exec tsc-rs --noEmit -p libs/persistence/tsconfig.json` | exit 0 |
| `pnpm exec vitest run --config apps/desktop-electron/vitest.config.ts` | 43 passed, 2 skipped |
| `pnpm exec vitest run --config libs/podcast-core/vitest.config.ts` | 20 passed |
| `pnpm exec vitest run --config libs/persistence/vitest.config.ts` | 24 passed |
| `pnpm exec vitest run --config libs/contracts/vitest.config.ts` | 9 passed |
| `node tools/build-electron.mjs` | exit 0, main 404.2 kB, preload 8.4 kB |
| `curl -L https://feeds.npr.org/510289/podcast.xml` | 200, `application/xml`, 2,204,116 bytes |
| real NPR feed parsed with `parsePodcastFeed` | test passed, >0 episodes |

The host integration suite starts a real local HTTP server and proves:

- HTML page → feed autodiscovery → feed + episode persistence;
- artwork download/cache and `statocyst-art://track/...` episode artwork;
- conditional GET / 304, then a new episode after the feed changes;
- redirects, body cap, HTML rejection without discovery;
- private address blocked with local networking off, allowed with it on;
- per-feed settings, played state, Apple/Fyyd search normalization/dedupe/cache, optional
  Podcast Index signing, feed removal and episode cleanup.

Logs:

- `/tmp/statocyst-s044-service-test.log`
- `/tmp/statocyst-s044-electron-test.log`
- `/tmp/statocyst-s044-electron-tsc.log`
- `/tmp/statocyst-s044-electron-build.log`
- `/tmp/statocyst-s044-real-feed.log`

## Not verified / next

- Apple/Fyyd live endpoints were reached with plain GETs while validating the provider
  responses; the service's provider bases are injectable so the local test server exercises
  the full merge/cache path. No user key is required.
- Optional Podcast Index remains developer-configured only; no user-facing key flow.
- The desktop UI (S045) is not present yet; the bridge is complete but unused by views.
- `removeFeed(deleteDownloads: true)` removes database rows (cascade) but does not yet
  delete download files; S047 owns that cleanup.
