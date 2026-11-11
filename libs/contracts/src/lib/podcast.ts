import type { MediaForm, MediaKind, PlaybackContext, Result, Track } from './playback';

export type { MediaForm, MediaKind, PlaybackContext };

/** Public directories used for discovery. Feeds are always resolved from the publisher. */
export type PodcastDirectorySource = 'apple' | 'fyyd' | 'podcast-index' | 'gpodder';

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
  /** Preferred presentation when an episode has both forms; absent means audio. */
  defaultMediaForm?: MediaForm;
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  /** HTTP validators used by the host for conditional refresh; optional on older hosts. */
  etag?: string | null;
  lastModified?: string | null;
  fetchError: string | null;
  unplayedCount: number;
  newEpisodeCount: number;
}

/** Editable per-feed settings. Feed identity and fetched state are host-owned. */
export interface PodcastFeedPatch {
  title?: string;
  refreshIntervalMinutes?: number;
  defaultSpeed?: number;
  skipIntroSeconds?: number;
  skipOutroSeconds?: number;
  autoQueue?: boolean;
  episodeSort?: 'newest' | 'oldest';
  defaultMediaForm?: MediaForm;
  subscribed?: boolean;
}

export interface PodcastEpisodeLink {
  title: string | null;
  url: string;
}

/** One usable media enclosure advertised by a feed. */
export interface PodcastEnclosure {
  url: string;
  type: string | null;
  form: MediaForm;
  lengthBytes: number | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
}

export interface PodcastEpisode extends Track {
  /** The podcast_episode row id, used for played/resume actions. `Track.id` is the playback media id. */
  episodeId: string;
  feedId: string;
  feedTitle: string;
  guid: string;
  descriptionText: string | null;
  links: PodcastEpisodeLink[];
  link: string | null;
  publishedAt: string | null;
  seasonNo: number | null;
  episodeNo: number | null;
  episodeType: string | null;
  explicit: boolean;
  enclosureUrl: string;
  enclosureType: string | null;
  /** Primary presentation; absent on older hosts means audio. */
  mediaForm: MediaForm;
  /** Additional usable enclosures, excluding the primary. */
  alternates: PodcastEnclosure[];
  posterUrl: string | null;
  videoWidth: number | null;
  videoHeight: number | null;
  playbackSpeed: number | null;
  resumePositionMs: number;
  played: boolean;
  completed: boolean;
  playCount: number;
  lastPlayedAt: string | null;
}

export interface PodcastSearchResult {
  feedUrl: string;
  /** Directory that found this show; subscribing still uses the publisher RSS feed. */
  source: PodcastDirectorySource;
  /** Provider-specific id (Apple collection id, Fyyd podcast id, etc.). */
  providerId?: string | null;
  title: string;
  author: string | null;
  descriptionText: string | null;
  artworkUrl: string | null;
  episodeCount: number | null;
  explicit: boolean;
  podcastIndexId: number | null;
  categories: string[];
}

/** One browse category derived from the directory's own show data. */
export interface PodcastDiscoveryCategory {
  /** Stable slug, e.g. `true-crime`. */
  id: string;
  name: string;
  /** How many of the directory's top shows carry this category. */
  count: number;
}

/** A category row on the Discovery page, with shows already grouped from the directory. */
export interface PodcastDiscoveryShelf {
  category: PodcastDiscoveryCategory;
  shows: PodcastSearchResult[];
}

/**
 * Directory-driven Discovery landing data. `top` is the provider's popularity
 * chart, `categories` come from the genres carried by those shows, and
 * `shelves` are the same shows grouped by category. No user input is required.
 */
export interface PodcastDiscovery {
  top: PodcastSearchResult[];
  categories: PodcastDiscoveryCategory[];
  shelves: PodcastDiscoveryShelf[];
}

export interface PodcastRefreshError {
  feedId: string;
  message: string;
}

export interface PodcastRefreshSummary {
  feedId: string | null;
  refreshed: number;
  newEpisodes: number;
  failed: number;
  errors: PodcastRefreshError[];
}

export interface PodcastImportSummary {
  added: number;
  duplicates: number;
  invalid: number;
  scheduled: number;
  feeds: PodcastFeed[];
}

export type PodcastChangeReason = 'added' | 'removed' | 'updated' | 'refreshed' | 'played';

export interface PodcastChangeEvent {
  type: 'feeds' | 'episodes';
  feedId: string | null;
  reason: PodcastChangeReason;
}

export interface PodcastDirectoryStatus {
  configured: boolean;
  provider: 'multiple';
  providers: PodcastDirectorySource[];
}

/**
 * Host-backed podcast library and discovery surface. Absent on older hosts.
 * Feed fetching, parsing and persistence stay in the host; the renderer only
 * receives validated library rows and typed results.
 */
export interface PodcastBridge {
  listFeeds(): Promise<PodcastFeed[]>;
  /**
   * Subscribe to the publisher feed. `artworkUrl` is optional directory
   * artwork used only when the feed itself carries no image.
   */
  addFeed(
    url: string,
    options?: { artworkUrl?: string | null },
  ): Promise<Result<PodcastFeed>>;
  updateFeed(feedId: string, patch: PodcastFeedPatch): Promise<Result<PodcastFeed>>;
  removeFeed(
    feedId: string,
    options?: { deleteDownloads?: boolean },
  ): Promise<Result<{ removed: boolean }>>;
  refresh(feedId?: string): Promise<PodcastRefreshSummary>;
  listEpisodes(
    feedId: string,
    options?: { limit?: number; offset?: number; sort?: 'newest' | 'oldest' },
  ): Promise<PodcastEpisode[]>;
  getEpisode(episodeId: string): Promise<PodcastEpisode | null>;
  setPlayed(episodeId: string, played: boolean): Promise<Result<PodcastEpisode>>;
  searchDirectory(query: string): Promise<Result<PodcastSearchResult[]>>;
  /** Cache a directory/search image locally and return a renderer-safe URL. */
  cacheArtwork(url: string): Promise<Result<{ url: string | null }>>;
  /** Landing data: provider top chart plus categories grouped from those shows. */
  discover(): Promise<Result<PodcastDiscovery>>;
  directoryStatus(): Promise<PodcastDirectoryStatus>;
  setDirectoryCredentials(
    apiKey: string,
    secret: string,
  ): Promise<Result<PodcastDirectoryStatus>>;
  clearDirectoryCredentials(): Promise<void>;
  importOpml(): Promise<PodcastImportSummary>;
  exportOpml(): Promise<Result<{ path: string | null; bytes: number }>>;
  onChanged(listener: (event: PodcastChangeEvent) => void): () => void;
}
