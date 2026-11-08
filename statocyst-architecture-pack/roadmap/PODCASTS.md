# MVP-5 — Podcasts (all platforms)

**Status:** IN_PROGRESS / BLOCKED (2026-11-08). Desktop + Android core implemented; iOS/CarPlay gates open. No all-platform claim is made.
**Decision record:** ADR-036.
**Slice range:** S042–S053.
**Platforms:** Electron desktop, Capacitor Android, Capacitor iOS, Android Auto, CarPlay.

## 1. Objective

Make Statocyst a local-first podcast client without weakening the music player:

- Discover shows through existing podcast directories and subscribe in one tap; users do not
  paste feed URLs.
- Keep a local podcast library with shows, episodes, played state, resume positions and
  per-show settings.
- Refresh feeds on launch, on foreground, on a timer while the host is running, and on
  demand, using conditional HTTP requests and bounded concurrency.
- Stream episodes through the existing media protocol; pin episodes for offline use.
- Ship the same experience on desktop, Android and iOS, including the existing car
  surfaces.

“Aggregate our own RSS feeds” means **subscribe and aggregate locally**. It does not mean
publishing a combined feed, re-hosting audio, or scraping directories.

## 2. Non-goals for MVP-5

- Publishing an aggregate OPML/RSS endpoint or re-hosting episode audio.
- Automatic per-show retention/auto-download (deferred; manual pins only).
- Chapters, transcripts, live items, value/streaming-payment tags, crossfade, sleep timer.
- Cross-device subscription/resume sync.
- Global unified search across music and podcasts.
- Raw HTML show notes, embedded players, or third-party tracking pixels.
- User-supplied feed/site URLs or OPML source import. No directory scraping and no user API
  keys.
- Background feed refresh while the mobile app is suspended (foreground/manual only in
  MVP-5; a later native background slice can add WorkManager/BGTaskScheduler).

## 3. Fit with the existing architecture

| Concern | Existing mechanism | Podcast extension |
| --- | --- | --- |
| Media identity | `media_item` + `media_source` | `media_kind='podcast'`; podcast side tables |
| Playback | `PlaybackService` + `playback-core` queue | Second persisted queue + active context |
| Rendering | `statocyst-media:` protocol + range proxy | Generic remote media resolver (Jellyfin + podcast) |
| Downloads | `download` table keyed by track id | Episode `media_item` id reuses it |
| Cache | `cache_entry` keyed by track id | Same, with podcast remote resolver |
| Bridge | typed `StatocystBridge` + IPC/preload | New `podcast` namespace and playback context |
| Mobile | Capacitor plugin + native DB/engine | Native fetch/persist methods; native podcast queue |
| Artwork | `statocyst-art://track/<id>` | Add `statocyst-art://feed/<id>`; cache art locally |
| Stats/search | music-only queries | Explicit `media_kind` filters everywhere |

The central design choice: **episodes become `media_item` rows** so the queue, downloads,
cache, range requests, protocol and bridge keep working. Everything podcast-specific lives
in `podcast_*` tables keyed by the media item id. The `media_kind` column is what prevents
podcasts from leaking into albums, artists, radio, playlists and music stats.

## 4. Data model

### 4.1 Desktop (libSQL) — migration 6

Additive migration with the existing pre-migration backup. The only table rebuild is the
small `media_source` table, needed to extend its `CHECK` constraint.

```sql
ALTER TABLE media_item ADD COLUMN media_kind TEXT NOT NULL DEFAULT 'music'
  CHECK (media_kind IN ('music', 'podcast'));
CREATE INDEX idx_media_item_kind ON media_item(media_kind);

ALTER TABLE playback_state ADD COLUMN active_context TEXT NOT NULL DEFAULT 'music'
  CHECK (active_context IN ('music', 'podcast'));

-- Rebuild the tiny source table so kind can be 'podcast'.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE media_source_v2 (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('local', 'demo', 'jellyfin', 'podcast')),
  label TEXT NOT NULL,
  root_path TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (kind, root_path)
);
INSERT INTO media_source_v2 (id, kind, label, root_path, created_at)
  SELECT id, kind, label, root_path, created_at FROM media_source;
DROP TABLE media_source;
ALTER TABLE media_source_v2 RENAME TO media_source;

CREATE TABLE podcast_feed (
  id TEXT PRIMARY KEY,
  feed_url TEXT NOT NULL UNIQUE,
  resolved_url TEXT,
  site_url TEXT,
  title TEXT NOT NULL,
  author TEXT,
  description_text TEXT,
  image_url TEXT,
  artwork_path TEXT,
  language TEXT,
  explicit INTEGER NOT NULL DEFAULT 0 CHECK (explicit IN (0, 1)),
  categories_json TEXT,
  feed_type TEXT NOT NULL CHECK (feed_type IN ('rss', 'atom')),
  podcast_index_id INTEGER,
  etag TEXT,
  last_modified TEXT,
  last_fetched_at TEXT,
  last_success_at TEXT,
  next_fetch_at TEXT,
  fetch_error TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  refresh_interval_minutes INTEGER NOT NULL DEFAULT 60,
  default_speed REAL NOT NULL DEFAULT 1.0,
  skip_intro_seconds INTEGER NOT NULL DEFAULT 0,
  skip_outro_seconds INTEGER NOT NULL DEFAULT 0,
  auto_queue INTEGER NOT NULL DEFAULT 1 CHECK (auto_queue IN (0, 1)),
  episode_sort TEXT NOT NULL DEFAULT 'newest' CHECK (episode_sort IN ('newest', 'oldest')),
  subscribed INTEGER NOT NULL DEFAULT 1 CHECK (subscribed IN (0, 1)),
  last_viewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_podcast_feed_due ON podcast_feed(next_fetch_at) WHERE subscribed = 1;

CREATE TABLE podcast_episode (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES podcast_feed(id) ON DELETE CASCADE,
  media_item_id TEXT NOT NULL UNIQUE REFERENCES media_item(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  description_text TEXT,
  links_json TEXT,
  link TEXT,
  enclosure_url TEXT NOT NULL,
  enclosure_type TEXT,
  enclosure_length_bytes INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  season_no INTEGER,
  episode_no INTEGER,
  episode_type TEXT,
  image_url TEXT,
  artwork_path TEXT,
  explicit INTEGER NOT NULL DEFAULT 0 CHECK (explicit IN (0, 1)),
  chapters_url TEXT,
  transcript_url TEXT,
  transcript_type TEXT,
  playback_speed REAL,
  resume_position_ms INTEGER NOT NULL DEFAULT 0,
  played INTEGER NOT NULL DEFAULT 0 CHECK (played IN (0, 1)),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT,
  first_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (feed_id, guid)
);
CREATE INDEX idx_podcast_episode_feed_date ON podcast_episode(feed_id, published_at DESC);
CREATE INDEX idx_podcast_episode_continue ON podcast_episode(last_played_at DESC)
  WHERE completed = 0 AND resume_position_ms > 0;

CREATE TABLE podcast_queue_entry (
  entry_id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES podcast_episode(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at TEXT NOT NULL
);
CREATE INDEX idx_podcast_queue_entry_position ON podcast_queue_entry(position);

CREATE TABLE podcast_playback_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_entry_id TEXT,
  position_ms INTEGER NOT NULL DEFAULT 0,
  speed REAL NOT NULL DEFAULT 1.0,
  updated_at TEXT NOT NULL
);
INSERT INTO podcast_playback_state (id, current_entry_id, position_ms, speed, updated_at)
  VALUES (1, NULL, 0, 1.0, CURRENT_TIMESTAMP);

CREATE TABLE podcast_directory_cache (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  query_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (provider, query_key)
);
```

**Rebuild gate:** the `PRAGMA defer_foreign_keys = ON` + drop/rename sequence must be tested
against a real v5 database with local, demo and Jellyfin sources, queue entries and
downloads. If libSQL rejects it inside the migration transaction, the migration runner gets
a narrowly scoped `foreignKeysOff` flag for this migration only; silently skipping the
`media_source` extension is not acceptable.

**Integrity rule:** deleting a feed or episode must not leave orphan `media_item` rows.
`removePodcastFeed` performs the cleanup in one transaction (episode media items first,
then the feed). A test asserts zero orphans and zero queue entries after removal.

### 4.2 Episode ↔ media item mapping

| `media_item` field | Episode value |
| --- | --- |
| `id` | UUID generated once, never the feed GUID |
| `source_id` | one deterministic `media_source` row (`id='podcast'`, `kind='podcast'`, label `Podcasts`); `root_path` null |
| `path` | enclosure URL (remote) |
| `path_key` | `podcast:<sha256(feedUrl + "\0" + guid)>` |
| `file_name` | episode title |
| `ext` | derived from content type/URL, allowlist, otherwise `bin` |
| `size_bytes` | enclosure length, 0 when unknown |
| `title` | episode title |
| `artist` | show title |
| `album` | show title |
| `album_artist` | show author |
| `track_no` | episode number |
| `disc_no` | season number |
| `year` | publication year |
| `genre` | `Podcast` |
| `duration_ms` | parsed duration, 0 when unknown |
| `bitrate` / `sample_rate` / `channels` | null |
| `codec` / `format` | container hint |
| `artwork_path` | cached local art (episode image, else feed image) |
| `media_kind` | `podcast` |

`path` is a remote URL, so `refreshMissing` must skip podcast rows exactly as it skips
Jellyfin rows.

### 4.3 Mobile schemas

- **Android:** Room v6 → v7. Add `mediaKind` (default `music`) to `media_item` plus
  `podcast_feed`, `podcast_episode`, `podcast_queue_entry`, `podcast_playback_state`,
  `podcast_directory_cache`. No source table rebuild is required.
- **iOS:** `StatocystDatabase.SCHEMA_VERSION` 5 → 6. Add the same column and tables with
  `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS`. The current iOS/Android version mismatch is
  reconciled in S042 so both schemas are documented side by side.
- Both native `listTracks`/stats/browse queries filter `mediaKind = 'music'`.
  `PodcastBridge`-backed queries use `mediaKind = 'podcast'`.

## 5. Contracts and bridge

### 5.1 Shared types (`libs/contracts`)

```ts
export type MediaKind = 'music' | 'podcast';
export type PlaybackContext = 'music' | 'podcast';

// Existing Track gains one optional field for older hosts.
export interface Track {
  // ...
  mediaKind?: MediaKind;
}

export interface PodcastFeed {
  id: string;
  feedUrl: string;
  siteUrl: string | null;
  title: string;
  author: string | null;
  descriptionText: string | null;
  imageUrl: string | null;
  artworkUrl: string | null;
  language: string | null;
  explicit: boolean;
  categories: string[];
  subscribed: boolean;
  refreshIntervalMinutes: number;
  defaultSpeed: number;
  skipIntroSeconds: number;
  skipOutroSeconds: number;
  autoQueue: boolean;
  episodeSort: 'newest' | 'oldest';
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  fetchError: string | null;
  unplayedCount: number;
  newEpisodeCount: number;
}

export interface PodcastEpisode extends Track {
  feedId: string;
  feedTitle: string;
  guid: string;
  descriptionText: string | null;
  links: Array<{ title: string | null; url: string }>;
  link: string | null;
  publishedAt: string | null;
  seasonNo: number | null;
  episodeNo: number | null;
  episodeType: string | null;
  explicit: boolean;
  enclosureUrl: string;
  enclosureType: string | null;
  playbackSpeed: number | null;
  resumePositionMs: number;
  played: boolean;
  completed: boolean;
  playCount: number;
  lastPlayedAt: string | null;
}
```

`PodcastSearchResult` carries `feedUrl`, `title`, `author`, `descriptionText`,
`artworkUrl`, `episodeCount`, `explicit`, `podcastIndexId`, `categories`.

### 5.2 Bridge surface

```ts
export interface PodcastBridge {
  listFeeds(): Promise<PodcastFeed[]>;
  addFeed(url: string): Promise<Result<PodcastFeed>>;
  updateFeed(feedId: string, patch: PodcastFeedPatch): Promise<Result<PodcastFeed>>;
  removeFeed(feedId: string, options?: { deleteDownloads?: boolean }): Promise<Result<{ removed: boolean }>>;
  refresh(feedId?: string): Promise<PodcastRefreshSummary>;
  listEpisodes(feedId: string, options?: { limit?: number; offset?: number; sort?: 'newest' | 'oldest' }): Promise<PodcastEpisode[]>;
  getEpisode(episodeId: string): Promise<PodcastEpisode | null>;
  setPlayed(episodeId: string, played: boolean): Promise<Result<PodcastEpisode>>;
  searchDirectory(query: string): Promise<Result<PodcastSearchResult[]>>;
  directoryStatus(): Promise<{ configured: boolean; provider: 'podcast-index' }>;
  setDirectoryCredentials(apiKey: string, secret: string): Promise<Result<{ configured: boolean }>>;
  clearDirectoryCredentials(): Promise<void>;
  importOpml(): Promise<PodcastImportSummary>;
  exportOpml(): Promise<Result<{ path: string | null; bytes: number }>>;
  onChanged(listener: (event: PodcastChangeEvent) => void): () => void;
}
```

Playback stays on the existing bridge with an explicit context:

```ts
interface PlaybackBridge {
  getSnapshot(context?: PlaybackContext): Promise<PlaybackSnapshot>;
  getQueue(context?: PlaybackContext): Promise<QueueSnapshot>;
  command(command: PlaybackCommand, context?: PlaybackContext): Promise<Result<PlaybackSnapshot>>;
  onEvent(listener: (event: PlaybackEvent) => void): () => void;
}
```

`PlaybackSnapshot` and `QueueSnapshot` gain `context: PlaybackContext` and
`active: boolean`. Existing music callers omit the argument and keep the music context.
Commands on an inactive context mutate its persisted queue without switching audio; a
play/seek/load command switches the active context, pausing the outgoing one. Queue and
state events carry their context, including changes made to the inactive queue. The engine
gains `playbackRate` in `EngineLoadRequest` and `{ action: 'rate'; rate: number }` in
`EngineCommand`.

### 5.3 IPC and preload

New `CHANNELS` entries: `podcast:list-feeds`, `podcast:add-feed`, `podcast:update-feed`,
`podcast:remove-feed`, `podcast:refresh`, `podcast:list-episodes`, `podcast:get-episode`,
`podcast:set-played`, `podcast:search-directory`, `podcast:directory-status`,
`podcast:set-directory-credentials`, `podcast:clear-directory-credentials`,
`podcast:import-opml`, `podcast:export-opml`, `podcast:changed`. Playback channels take a
second context argument. Every argument is validated in the main process; feed bodies are
never accepted from the renderer.

## 6. Feed ingestion pipeline

### 6.1 Fetch

`FeedFetcher` is a host adapter (Electron main, Android OkHttp, iOS URLSession) with one
shared policy:

- `GET` with conditional headers (`If-None-Match`, `If-Modified-Since`), `Accept` for RSS,
  Atom and XML, and a truthful Statocyst user agent with a project URL.
- Timeouts: 15 s connect, 30 s total. Max body: 5 MB compressed and 10 MB decompressed.
  Max redirects: 5, every hop revalidated.
- Accept only `application/rss+xml`, `application/atom+xml`, `application/xml`,
  `text/xml`, `application/xhtml+xml`, or `text/html` for discovery.
- 304 updates `last_fetched_at`/`next_fetch_at` and clears the error. 4xx (except 429)
  backs off hard; 429 honors `Retry-After`; 5xx uses exponential backoff with jitter.
- Concurrency: 3 global, 1 per host. Jitter on `next_fetch_at`.
- On redirect/moved-permanent, store `resolved_url` and keep fetching that; the user-facing
  `feed_url` stays as entered.
- Feed failures keep the existing episodes. Errors are per-feed, not global.

### 6.2 Parse

Shared `libs/podcast-core` (pure, no network):

- RSS 2.0, Atom 1.0, iTunes namespace, Podcast 2.0 namespace (recognized, only the fields
  in the schema are persisted).
- Reject `<!DOCTYPE` and `<!ENTITY` before parsing. Parser configured with entities off;
  node count/depth caps; no external resolution.
- GUID: RSS `guid`, Podcast 2.0 `podcast:guid`, else SHA-256 of the enclosure URL. GUIDs
  are trimmed but not case-folded (feeds treat them as opaque).
- Dates: RFC 822 and RFC 3339. Invalid dates are stored as `null` and sorted by
  `first_seen_at`, never silently treated as “now”.
- Duration: `itunes:duration` (`HH:MM:SS`, `MM:SS`, or seconds), then `media:content`
  duration; else 0. The engine-reported duration fills it after first play.
- Enclosure: RSS `<enclosure>` / Atom `<link rel="enclosure">`; resolve relative URLs
  against the final feed URL; reject non-HTTP(S). Episodes without an enclosure are
  skipped and counted.
- Episode cap: keep the newest 2,000 per feed; the refresh summary reports truncation.
- Titles/descriptions: decode entities, collapse whitespace, strip markup into
  `description_text`; extract at most 20 safe links into `links_json`. Raw HTML is
  discarded.

### 6.3 Normalize, diff and persist

- Normalize the feed URL (lowercase scheme/host, strip default port, remove fragment,
  preserve query). Reject URLs with embedded credentials.
- Upsert by `(feed_id, guid)`. Existing episodes keep their media item id, resume, played
  state and download. Changed titles/art update in place.
- New episodes get `first_seen_at = now`; the feed's unread/new count is derived from
  `first_seen_at > last_viewed_at` and `played = 0`.
- Feed + episodes + media items are written in one transaction. Partial refreshes never
  leave orphan rows.
- Artwork is fetched after the parse (2 concurrent, 2 MB cap, content-type allowlist) and
  cached under the artwork directory. Episode image wins; feed image is the fallback.
  Failed art is non-fatal and retried on the next refresh.

### 6.4 Scheduling

- On subscribe: immediate fetch.
- On startup: due feeds after the app is interactive.
- On foreground/focus: refresh due feeds; on desktop also a 15-minute due check while
  running.
- Manual refresh for one feed or all.
- Per-feed interval (default 60 minutes; range 15–1440) with backoff on failure.
- Mobile background refresh while suspended is **out of scope** for MVP-5. The feed's
  `next_fetch_at` is still persisted, so the next foreground refresh is immediate.

## 7. Discovery (directory-first)

The Podcasts section is a **discovery mechanism**, not a feed importer. Users search or
browse a directory, choose a show, and Statocyst resolves the publisher feed and subscribes
automatically. The user never pastes an RSS/Atom URL and never configures a directory key.

### 7.1 Providers

- **Apple Podcasts (iTunes Search API)** — keyless, public search returning `feedUrl`,
  artwork, author, episode count, genre and explicitness. Approximately 20 requests/minute
  per IP; cache results for 15 minutes and back off on throttling. Show “Apple Podcasts” as
  the source in results.
- **Fyyd (API 0.2)** — keyless search returning `xmlURL`, title, author, description,
  artwork and status. Use as a second catalog with different coverage; show “Fyyd”.
- **Podcast Index (optional)** — only when the application is built with
  developer/environment-provided key and secret. It is never requested from the user and
  there is no in-app credential form. If present, merge its results with the keyless
  providers.
- **Apple Top Charts** — keyless marketing RSS feed for the Discovery landing. It returns
  popularity-ranked shows with genres but no feed URLs, so resolve ids through the iTunes
  lookup endpoint before rendering. Categories and category rows are derived from the
  genres carried by that chart, so the landing reflects data the provider actually exposes.

No scraping. Cache directory responses locally. Show provider attribution in the UI and
handle rate limits with backoff and partial results.

### 7.2 Landing, categories and search

- The Podcasts screen has three tabs: **Subscribed**, **Downloaded** and **Discovery**.
  Show detail remains a back-stack destination from any tab.
- **Discovery** opens on data, not a search box: a Top podcasts row from the provider chart,
  a category grid derived from those shows, and category rows grouping the same shows.
  Tapping a category queries the directories with that category name and shows the results.
- Search is a secondary action on the Discovery tab. A query with no result shows a clear
  empty state and a way back to the landing, not a URL form.
- The host queries Apple and Fyyd concurrently, normalizes both into
  `PodcastSearchResult`, dedupes by normalized feed URL, and prefers the richer record while
  preserving Apple’s catalog identity. If one provider fails, return the other’s results.
- Results show artwork, title, author, description when available, source badge and an
  episode count. “Subscribe” fetches the publisher feed through the existing SSRF/parse/
  persist pipeline and adds the show to the local library.
- The feed URL is an internal implementation detail; it is never rendered as an editable
  field or copied by the user.

### 7.3 Source policy

- No user-supplied feed URLs, site URLs or OPML import in the consumer flow. OPML parsing
  may remain as a developer diagnostic only.
- No user-entered API keys. Optional Podcast Index credentials come from the build
  environment and are never persisted in the renderer or shown in logs.
- Search is available on a fresh install with no setup.
- Provider failures are isolated; the app remains usable with the other provider and with
  already-subscribed shows.

## 8. Playback

### 8.1 Contexts

`PlaybackService` owns two persisted queues:

- music: existing `queue_entry` + `playback_state`.
- podcast: `podcast_queue_entry` + `podcast_playback_state`.

`playback_state.active_context` is the only audio source. The service exposes snapshots
per context and marks which one is active. Starting a podcast pauses music; starting music
pauses the podcast. Enqueue/remove/reorder/shuffle on an inactive context does not switch
audio.

### 8.2 Resume and completion

- Episode resume position lives on `podcast_episode.resume_position_ms` and is mirrored to
  `podcast_playback_state` for the current entry. It is written on pause, seek, context
  switch, track change, app shutdown, and at most every 10 seconds while playing.
- Playing an in-progress, non-completed episode starts at its resume position. Playing a
  completed episode starts at 0.
- Completed when position ≥ `max(duration - 30 s, 95% of duration)` or the user marks it
  played. Completion sets `played=1`, `completed=1`, and clears resume.
- Manual “mark unplayed” clears `played`, `completed`, and resume.
- Auto-advance follows the existing queue order. When a show is played, the UI seeds the
  podcast queue from that show's episodes in the feed's `episode_sort`, so “next” is
  predictable. No hidden auto-refill.

### 8.3 Speed and skip

- Per-feed `default_speed`; per-episode `playback_speed` overrides.
- Speed applies through `EngineLoadRequest.playbackRate` / native equivalents and survives
  track changes within the podcast context.
- Skip intro/outro buttons seek by the feed's configured seconds. Automatic skipping is
  deferred.
- Native media sessions map seek-back/seek-forward to the configured podcast intervals
  where the platform supports it, and keep speed/position on the lock screen.

### 8.4 Engine and protocol

- The renderer keeps using `statocyst-media://track/<id>`.
- `ProtocolTrack.remote` becomes a union: Jellyfin (server URL, item id, token, quality
  mode) or podcast (enclosure URL, optional headers). Existing Jellyfin behavior is
  unchanged.
- The protocol proxy forwards Range, follows safe redirects, bounds timeouts, never
  forwards credentials to podcast hosts, and revalidates the enclosure URL before each
  play/download.
- A verified download wins over a cache hit; a cache hit wins over the network. The same
  precedence as today.

## 9. Downloads and offline

- Manual pin from the episode row or Now Playing. No auto-retention in MVP-5.
- `DownloadService` stops being Jellyfin-specific: a `RemoteAudioResolver` returns a URL
  and optional headers for any `sourceKind`. Podcast resolution is the enclosure URL.
- Downloads reuse the existing `.part` → hash → rename flow, quota, Wi-Fi policy, progress
  events, protected-download eviction rules and native download queue.
- Size is shown before pinning when the enclosure reports it; unknown sizes are allowed.
- A pinned episode plays from disk with no network. The episode row stays if the download
  is removed.
- Offline view groups music and podcast pins. An unpinned episode attempted offline shows
  “Download to listen offline”, not a silent skip.
- Removing a feed asks whether to delete its downloads; the default keeps files until the
  user confirms.

## 10. UI

### 10.1 Navigation and views

Add a **Podcasts** primary destination. Internal navigation uses
`PodcastsStore.selectedFeedId` / `selectedEpisodeId` with the existing bounded history:

- **Podcasts home:** Continue Listening, New Episodes, subscriptions, add button.
- **Show detail:** artwork, title, author, description, subscribe/refresh, settings,
  episode list with season grouping, filters (all/unplayed/downloaded), show notes.
- **Discover podcasts:** directory search, topic chips, source badges, one-tap subscribe;
  no URL field or user-facing credentials.
- **Episode / Now Playing:** show notes, safe links, progress, speed, skip, download,
  mark played, queue.
- **Podcast queue:** separate from the music queue, with an “active” indicator.

### 10.2 Music separation

- `library.listTracks()` returns music only; `PodcastBridge` returns episodes.
- `library.stats()` and native `libraryStats` count music only; podcast counts are separate.
- Radio, playlists, favorites, album/artist views and global music search ignore
  `media_kind='podcast'`.
- Episodes are not added to music playlists or favorites in MVP-5. Subscription, downloads
  and queue are the podcast equivalents.

### 10.3 Player bar and Now Playing

The player bar adapts to the active context. Podcast mode shows speed, skip-back/skip-
forward, download state and episode progress. The existing music controls are unchanged.
The player bar never mixes queues: it always shows the active context and offers a clear
way to return to the other context.

### 10.4 Accessibility and motion

- Every new control has an accessible name and keyboard path; episode lists are windowed.
- Respect reduced motion; no new animation dependency.
- Contrast/light-theme parity uses existing tokens.
- Show notes links are buttons/anchors that open externally through a safe allowlist.

## 11. Platform plan

### 11.1 Electron desktop

- New `PodcastService` in the main process: fetcher, parser worker, repository, scheduler,
  directory providers (Apple/Fyyd/optional Podcast Index), art cache.
- New preload/IPC surface; renderer gets `PodcastBridge`.
- Fetcher uses Node `fetch`/undici with the SSRF guard; parsing runs in a worker thread so a
  large feed cannot stall the main process.
- Secrets in `safeStorage`; no key material in `app_state`.

### 11.2 Android

- Shared renderer UI, with a native adapter:
  - `fetchPodcastFeedXml` (OkHttp, SSRF guard, conditional headers, body cap).
  - `savePodcastFeed` / `savePodcastEpisodes` (Room v7, one transaction).
  - `listPodcastFeeds` / `listPodcastEpisodes` / `updatePodcastFeed` /
    `removePodcastFeed` / `setEpisodePlayed`.
  - `cachePodcastArtwork` and `podcastIndexSearch` / credential methods.
- Renderer orchestrates: native fetch → shared TS parse → native persist. This keeps one
  parser and one set of normalization rules. Background refresh while the WebView is dead
  is deferred.
- Media3 gains a podcast context: queue persistence, resume writes, speed, skip intervals,
  media-session metadata, and download source resolution.
- Room queries filter `mediaKind`; browse tree and widgets get podcast-aware behavior in the
  car slice.

### 11.3 iOS

- Same adapter shape with `URLSession`, SQLite v6, Keychain, `AVPlayer.rate`, background
  audio and `MPRemoteCommandCenter`.
- `PlaybackManager` gains the podcast context and resume writes; `LocalMediaServer` serves
  downloads and artwork.

### 11.4 Android Auto / CarPlay

- Add a Podcasts root: Subscriptions → Episodes → Resume/Play, plus Continue Listening.
- Browse and playback use native persisted rows; no WebView dependency.
- Driver-safe: no show-notes reading, no external links, bounded list sizes.
- Car surfaces ship in the same release; if a platform gate is blocked, MVP-5 is not
  released.

## 12. Security, privacy and correctness

### 12.1 URL safety (feed, redirect, artwork, enclosure, download, playback)

- Only `http:`/`https:`; reject embedded credentials, `file:`, `data:`, `blob:` and unknown
  schemes.
- Reject loopback, private, link-local, CGNAT, multicast and metadata addresses after DNS
  resolution, and re-check every redirect. IPv4-mapped IPv6 is normalized.
- Default: private-network feeds are blocked. An explicit “Allow local network feeds”
  setting permits RFC1918/ULA feeds but still blocks link-local/metadata. The setting is
  off by default and the UI states the risk.
- Redirect cap, timeout, body cap and content-type allowlist are enforced at every fetch.
- Residual DNS-rebinding risk is documented; the native/host adapters resolve and validate
  all addresses before connecting, and revalidate on each request.

### 12.2 Untrusted content

- Reject DTD/entities before XML parsing; disable entity expansion; cap nodes/depth.
- Never inject feed HTML into the DOM. Store/display plain text and a bounded link list.
- Sanitize/allowlist link schemes (`http:`/`https:`) before `shell.openExternal` /
  `UIApplication.open`.
- Artwork is downloaded and validated as an image, not rendered from a remote URL by
  default.
- Feed bodies, episode descriptions and private feed URLs never enter logs or support
  bundles. Log hostnames and hashed URLs only.

### 12.3 Credentials and data sovereignty

- Optional Podcast Index key/secret: build/environment only. Never in the catalog, renderer
  `localStorage`, support bundle or logs.
- Subscriptions, history and resume are local by default and never sent to a directory
  provider.
- No analytics, no tracking pixels, no third-party embeds.

### 12.4 Content and legal

- Stream/download for the user's personal listening only; Statocyst does not re-host or
  redistribute audio.
- Respect Podcast Index terms and attribution; no scraping.
- Explicit content is flagged, not hidden by default.
- Feed content is the publisher's; show-notes links open in the user's browser.

## 13. Performance budgets

- Feed parse: 5 MB body, 2,000 episodes; desktop parsing off the main thread.
- Global fetch concurrency 3; per-host 1; refresh jitter; no unbounded retry loops.
- Artwork: 2 MB each, 2 concurrent, cached on disk, no hotlink fallback by default.
- Episode list: paged queries (50) + windowed rendering; no full-library episode load.
- Home queries: continue-listening/new-episode limits (12/20), indexed by feed/date.
- DB write transactions per feed refresh, not per episode.
- No podcast work on the music playback hot path.
- Measure: 100 subscriptions / 10,000 episodes on the named reference device before
  claiming the gate.

## 14. Migration and compatibility

- Desktop: migration 6 is additive except the small `media_source` rebuild; the existing
  `VACUUM INTO` backup runs first. A migration test starts from a real v5 fixture with
  local/demo/Jellyfin data, queue and downloads.
- Android: Room v6 → v7, preserving media items, downloads, favorites and playlists.
- iOS: schema 5 → 6, idempotent `ALTER`/`CREATE` guarded by the schema version.
- Older hosts without podcast support simply never expose the bridge; the renderer keeps
  the Podcasts destination hidden/disabled rather than throwing.
- `Track.mediaKind` is optional on the wire so older payloads still validate.
- No existing music queue, download or play-history row is rewritten.

## 15. Testing and evidence

| Layer | Required |
| --- | --- |
| Parser | RSS, Atom, iTunes, Podcast 2.0, malformed, XXE/billion-laughs, missing GUID, bad dates, durations, relative URLs, truncation |
| Discovery | Apple/Fyyd normalization, dedupe, partial provider failure, cache, rate-limit backoff |
| URL safety | private/loopback/metadata, IPv4-mapped IPv6, redirect to private, credentials in URL, non-HTTP schemes |
| Repository | feed+episode+media transaction, orphan cleanup, idempotent refresh, resume/played updates |
| Playback | two contexts, switch pauses/restores, resume persisted, completion threshold, speed survives track change, queue commands on inactive context |
| Protocol | podcast remote proxy, Range, redirect, 403/404, download precedence |
| Desktop E2E | add local fixture feed → episode → play/seek → switch to music → resume → download → offline → restart |
| Android | Room migration, instrumentation for resume/queue/download, Media3 background, car browse |
| iOS | SQLite migration, playback/resume, background audio, car browse |
| Performance | 100 feeds / 10k episodes, feed parse latency, memory, list scroll |
| Security | no secrets in DB/logs/bundle; no raw HTML; URL guard at every entry point |

Evidence is recorded per slice in `evidence/S042-report.md` … `S053-report.md` with command,
exit code, environment, logs and artifacts. Unit tests alone do not make a platform gate
VERIFIED.

## 16. Slice map

| Slice | Scope | Depends on |
| --- | --- | --- |
| S042 | Contracts, schema, migrations, episode mapping | — |
| S043 | Shared feed parser, OPML, sanitizer, URL policy | S042 |
| S044 | Desktop ingestion, scheduler, directory providers, IPC | S042, S043 |
| S045 | Podcast library and discovery UI | S044, S046 |
| S046 | Two-context playback, resume, speed/skip | S042 |
| S047 | Manual downloads and offline behavior | S044, S046 |
| S048 | Android data, fetch, persistence | S043, S044, S045 |
| S049 | Android playback, downloads, background | S046, S047, S048 |
| S050 | iOS data, fetch, persistence | S044, S045 |
| S051 | iOS playback, downloads, background | S046, S047, S050 |
| S052 | Android Auto + CarPlay podcast browse | S049, S051 |
| S053 | Cross-platform verification, performance, release gate | S045, S047, S049, S051, S052 |

## 17. Risks and open questions

| Risk | Mitigation / decision |
| --- | --- |
| Mobile refresh needs the WebView; background refresh deferred | Refresh on foreground/manual; persist `next_fetch_at`; native background refresh is a later slice |
| `media_source` rebuild fails under libSQL FK rules | Deferred-FK transaction + v5 fixture test; narrow migration-runner fallback if required |
| Feed variety is hostile | Tolerant parser, caps, fixtures from real feeds, per-feed error isolation |
| Large episodes exhaust storage | Size display, shared quota, manual pins, download removal |
| Provider throttling / one directory down | Cache, backoff, partial results; keyless Apple/Fyyd need no setup |
| SSRF / DNS rebinding | Multi-layer URL guard, redirect revalidation, private-network default deny, documented residual risk |
| Artwork privacy | Cache locally; no hotlink by default |
| One engine, two queues confuses users | Explicit active-context indicator; switching always pauses; tests for cross-context commands |
| All-platform release is large | Feature-complete internally per platform, but one release gate; no partial public claim |
| Native schema drift (Android v6 / iOS v5) | Reconciled and documented in S042; migration tests on both |
| Feed URL tokens leak in logs | Redact to hostname/hash everywhere; support-bundle test |
| Parser dependency maintenance | One parser, pinned, license-audited; parser isolated behind `libs/podcast-core` |

Open questions with current defaults:

- Global search includes episodes? **No** in MVP-5; podcast-local search only.
- Episodes in favorites/playlists? **No**; subscription/download/queue replace them.
- Auto-download? **Deferred**; manual pins only.
- Sleep timer? **Deferred**.
- Cross-device subscriptions? **Out of scope**.
- OS notifications for new episodes? **Badge only** in MVP-5.
- Explicit-content filter? **Flag only** by default; a filter can be added later.

## 18. Release gate (MVP-5)

All of the following are required before MVP-5 is called VERIFIED:

1. A fresh install can search Apple Podcasts and Fyyd and subscribe in one tap with no URL,
   OPML or user API key.
2. A refresh discovers new episodes, keeps old ones, handles 304 and failure without data
   loss, and never leaves orphan rows.
3. An episode streams, seeks, resumes after restart, switches contexts without losing the
   other queue, and advances at completion.
4. A pinned episode plays offline on desktop, Android and iOS; unpinned episodes fail with
   clear copy; removal is clean.
5. Music views, stats, radio, playlists and favorites show no podcast rows.
6. Feed HTML is not rendered raw; URL safety tests cover feed, redirect, art, enclosure and
   download; no secrets appear in catalog rows, logs or support bundles.
7. Android Auto and CarPlay browse and play podcasts without the WebView.
8. Migration tests pass from real v5 desktop, v6 Android and v5 iOS databases.
9. Performance gate passes at 100 subscriptions / 10,000 episodes on the named device.
10. Evidence reports S042–S053 are complete; any blocked platform gate is recorded as
    BLOCKED and blocks the release.

## 19. Deferred after MVP-5

- Native background feed refresh (WorkManager / BGTaskScheduler).
- Automatic per-show retention and smart cleanup.
- Chapters, transcripts, live items, alternate enclosures and value/streaming metadata.
- Sleep timer and automatic intro/outro skipping.
- Cross-device subscription/resume sync.
- Global unified music + podcast search and recommendations.
- Rich sanitized HTML show notes.
- OPML/RSS publishing or any re-hosting of audio.
- User-supplied feed URLs or OPML onboarding.
