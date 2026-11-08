# Evidence report: S048 — Android podcast data and ingestion

**Status:** IMPLEMENTED_UNVERIFIED (emulator + native tests pass; physical device pending S053)
**Date:** 2026-11-08
**Depends on:** S043, S044, S045

## Landed

### Native storage

- `PodcastRepository` maps feed/episode JSON onto Room:
  - upserts `podcast_feed` by URL;
  - converts each episode into a `media_item` with `mediaKind='podcast'`,
    `sourceKind='podcast'`, stable `pathKey`, show metadata, enclosure and duration;
  - preserves episode resume/played/completed/play count on refresh;
  - transactional save/update/remove and played-state updates.
- `PodcastEpisodeRecord` carries the feed title and media row so the plugin can emit the
  same `PodcastEpisode` shape as desktop.
- `PodcastDao` adds lookup by `(feedId, guid)` and the existing queue/state/cache methods.

### Native transport

- `PodcastTransport`:
  - `HttpURLConnection` GET with timeouts, 15 MiB feed cap, content-type allowlist;
  - manual redirects with revalidation of every hop;
  - IPv4/IPv6 private/loopback/link-local/metadata blocking, with a local-network option;
  - conditional `If-None-Match`/`If-Modified-Since` and 304;
  - image fetch (8 MiB) and JSON/XML directory fetch for keyless provider search.

### Plugin methods

`fetchPodcastText`, `cachePodcastArtwork`, `listPodcastFeeds`, `listPodcastEpisodes`,
`getPodcastEpisode`, `savePodcastFeed`, `updatePodcastFeed`, `removePodcastFeed`,
`setPodcastEpisodePlayed`, `podcastDirectoryStatus`.

- Feed artwork is cached under `files/podcast-art` and exposed through the loopback media
  server; that app-private root is now on the server's allowlist, so cover URLs return the
  image instead of 403. `trackJson` resolves podcast artwork locally instead of using
  external-art lookup.
- Music `listTracks`/stats/radio and plugin JSON already filter/expose `mediaKind` from
  S042.

### Shared renderer bridge

- `createCapacitorPodcastBridge` implements the full `PodcastBridge` on top of the native
  methods:
  - native fetch → shared `parsePodcastFeed` → native save;
  - site HTML → shared link discovery → feed fetch;
  - refresh with native HTTP validators, new-episode counting and failure/backoff state;
  - artwork cache, list/get/update/remove/played;
  - keyless Apple/Fyyd search through native fetch + shared directory normalizers;
  - change listeners for the UI store.
- `CapacitorBridge` now exposes the `podcast` bridge, so the same Podcasts view works on
  Android once the release includes this build.

## Commands and results

| Command | Result |
| --- | --- |
| `./gradlew :app:compileDebugKotlin` (JDK 21, SDK 36) | BUILD SUCCESSFUL |
| `./gradlew :app:testDebugUnitTest` | BUILD SUCCESSFUL |
| `./gradlew :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=net.christopherrutherford.statocyst.podcast.PodcastRepositoryTest` (Medium_Phone_API_36.1 AVD) | 2 passed |
| `pnpm exec tsc-rs --noEmit -p apps/desktop/tsconfig.json` | exit 0 |

Instrumented tests:

- save a feed + episode, verify the media row is `mediaKind=podcast`, feed title, duration,
  played/completed transitions, settings update and remove cleanup;
- verify keyless directory fetch/normalization through the native transport (provider server fixture).

Logs:

- `/tmp/statocyst-s048-android.log`
- `/tmp/statocyst-s048-android-test.log`
- `/tmp/statocyst-s048-desktop-tsc.log`

## Not verified / next

- Physical Android device is pending S053; only the emulator and local tests ran.
- Media3 podcast playback, queue, resume and podcast downloads are S049.
- Background refresh while the WebView is dead remains deferred.
