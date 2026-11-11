import type { MediaForm, PodcastEnclosure, PodcastEpisodeLink } from '@statocyst/contracts';

export type PodcastFeedType = 'rss' | 'atom';

export interface ParsedPodcastEpisode {
  guid: string;
  title: string;
  descriptionText: string | null;
  links: PodcastEpisodeLink[];
  link: string | null;
  enclosureUrl: string;
  enclosureType: string | null;
  enclosureLengthBytes: number | null;
  /** Form of the primary enclosure; audio wins when both forms are advertised. */
  mediaForm: MediaForm;
  /** Additional usable enclosures, excluding the primary. Bounded to 8. */
  alternates: PodcastEnclosure[];
  /** Episode image, then media:thumbnail, then null. */
  posterUrl: string | null;
  /** Dimensions of the first video enclosure, when the feed declares them. */
  videoWidth: number | null;
  videoHeight: number | null;
  durationMs: number;
  publishedAt: string | null;
  seasonNo: number | null;
  episodeNo: number | null;
  episodeType: string | null;
  imageUrl: string | null;
  explicit: boolean;
  chaptersUrl: string | null;
  transcriptUrl: string | null;
  transcriptType: string | null;
  /** Stable media identity; same feed URL + GUID always produces this value. */
  pathKey: string;
}

export interface ParsedPodcastFeed {
  feedUrl: string;
  resolvedUrl: string;
  feedType: PodcastFeedType;
  title: string;
  author: string | null;
  descriptionText: string | null;
  siteUrl: string | null;
  imageUrl: string | null;
  language: string | null;
  explicit: boolean;
  categories: string[];
  podcastIndexId: number | null;
  episodes: ParsedPodcastEpisode[];
  /** Episodes dropped because the feed exceeded the per-feed cap. */
  truncated: number;
  /** Items skipped because they had no valid HTTP(S) enclosure or duplicate GUID. */
  dropped: number;
  warnings: string[];
}

export interface ParsePodcastFeedOptions {
  /** Canonical feed URL entered by the user. */
  feedUrl: string;
  /** Final URL after redirects; defaults to feedUrl. */
  resolvedUrl?: string;
  /** Maximum XML bytes accepted (default 5 MiB). */
  maxBytes?: number;
  /** Episodes retained per feed (default 2,000). */
  maxEpisodes?: number;
  /** Allow private/loopback feed hosts. Host adapters resolve DNS separately. */
  allowLocalNetwork?: boolean;
}

export interface OpmlFeed {
  title: string | null;
  feedUrl: string;
  siteUrl: string | null;
}

export interface ParsedOpml {
  title: string | null;
  feeds: OpmlFeed[];
  invalid: number;
  duplicates: number;
  truncated: boolean;
}

export interface ParseOpmlOptions {
  maxFeeds?: number;
  allowLocalNetwork?: boolean;
}
