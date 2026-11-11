import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  ErrorCode,
  MediaForm,
  PodcastChangeEvent,
  PodcastDirectoryStatus,
  PodcastDiscovery,
  PodcastEpisode,
  PodcastFeed,
  PodcastFeedPatch,
  PodcastImportSummary,
  PodcastRefreshSummary,
  PodcastSearchResult,
  Result,
} from '@statocyst/contracts';
import { fail, ok } from '@statocyst/contracts';
import {
  checkHttpUrl,
  decodeEntities,
  normalizeFeedUrl,
  parseAppleSearch,
  parseAppleTopCharts,
  parseFyydSearch,
  buildPodcastDiscovery,
  dedupeDirectoryResults,
  parseOpml,
  parsePodcastFeed,
  PodcastParseError,
  redactUrlForLog,
  resolveHttpUrl,
  serializeOpml,
} from '@statocyst/podcast-core';
import type {
  PodcastEpisodeUpsert,
  StatocystDatabase,
  StoredPodcastEpisode,
  StoredPodcastFeed,
} from '@statocyst/persistence';
import type { TokenCodec } from './credential-store';
import { PodcastFetchError, type FeedFetcher, type FetchedText } from './podcast-fetcher';
import { PodcastDirectoryError, PodcastIndexClient } from './podcast-index-client';
import type { Logger } from './logger';

const DIRECTORY_CREDENTIALS_KEY = 'podcast.index.credentials';
const DIRECTORY_PROVIDER = 'discovery';
const DIRECTORY_CACHE_MS = 15 * 60_000;
const DISCOVERY_CACHE_MS = 30 * 60_000;
const APPLE_TOP_URL = 'https://itunes.apple.com/us/rss/toppodcasts/limit=100/json';
const APPLE_LOOKUP_BASE = 'https://itunes.apple.com/lookup';
const DEFAULT_REFRESH_MINUTES = 60;
const MAX_REFRESH_MINUTES = 1_440;
const MIN_REFRESH_MINUTES = 15;

export interface PodcastServiceOptions {
  database: StatocystDatabase;
  fetcher: FeedFetcher;
  logger: Logger;
  artworkDirectory: string;
  codec: TokenCodec;
  directory: PodcastIndexClient;
  /** Developer/app-level Podcast Index credentials; never asked from the user. */
  directoryCredentials?: { apiKey: string; secret: string } | null;
  appleSearchBaseUrl?: string;
  fyydSearchBaseUrl?: string;
  /** Full Apple top-charts JSON URL; defaults to the US top 100 shows feed. */
  appleTopUrl?: string;
  /** Apple iTunes lookup endpoint used to resolve chart ids to feed URLs. */
  appleLookupBaseUrl?: string;
  allowLocalNetwork: () => boolean;
  refreshOnLaunch: () => boolean;
  userAgent: string;
  now?: () => Date;
  onChanged?: (event: PodcastChangeEvent) => void;
}

export interface ImportOpmlOptions {
  /** Kick off a background refresh after adding feeds (default true). */
  refresh?: boolean;
}

export class PodcastService {
  private timer: NodeJS.Timeout | null = null;
  private launchTimer: NodeJS.Timeout | null = null;
  private readonly now: () => Date;

  constructor(private readonly options: PodcastServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  private get database(): StatocystDatabase {
    return this.options.database;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refreshDue().catch((error) => {
        this.options.logger.warn('podcast.refresh.due.failed', { error: errorMessage(error) });
      });
    }, 60_000);
    if (this.options.refreshOnLaunch()) {
      this.launchTimer = setTimeout(() => {
        void this.refreshDue().catch((error) => {
          this.options.logger.warn('podcast.refresh.launch.failed', {
            error: errorMessage(error),
          });
        });
      }, 3_000);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.launchTimer) clearTimeout(this.launchTimer);
    this.timer = null;
    this.launchTimer = null;
  }

  async listFeeds(): Promise<PodcastFeed[]> {
    return (await this.database.listPodcastFeeds()).map(toPodcastFeed);
  }

  async addFeed(
    url: string,
    options: { artworkUrl?: string | null } = {},
  ): Promise<Result<PodcastFeed>> {
    const normalized = normalizeFeedUrl(url, {
      allowLocalNetwork: this.options.allowLocalNetwork(),
    });
    if (!normalized) {
      return fail(
        'INVALID_ARGUMENT',
        'The feed URL is invalid, uses a blocked address, or is not HTTP(S)',
      );
    }
    const existing = await this.database.getPodcastFeedByUrl(normalized);
    try {
      const loaded = await this.loadFeed(normalized);
      const directoryArtwork = this.validArtworkUrl(options.artworkUrl ?? null);
      // Directory artwork is a predictable catalog size; prefer it when we have
      // one so a multi-megabyte publisher cover cannot fail the cache step.
      const directoryArtworkPath = await this.cacheArtwork(directoryArtwork);
      const artworkPath =
        existing?.artworkPath ??
        directoryArtworkPath ??
        (await this.cacheArtwork(loaded.parsed.imageUrl));
      const imageUrl =
        existing?.artworkPath || directoryArtworkPath
          ? (directoryArtwork ?? loaded.parsed.imageUrl)
          : loaded.parsed.imageUrl;
      const feed = await this.database.upsertPodcastFeed({
        feedUrl: normalized,
        resolvedUrl: loaded.parsed.resolvedUrl,
        siteUrl: loaded.parsed.siteUrl,
        title: loaded.parsed.title,
        author: loaded.parsed.author,
        descriptionText: loaded.parsed.descriptionText,
        imageUrl,
        artworkPath,
        language: loaded.parsed.language,
        explicit: loaded.parsed.explicit,
        categories: loaded.parsed.categories,
        feedType: loaded.parsed.feedType,
        podcastIndexId: loaded.parsed.podcastIndexId,
        etag: loaded.fetched.etag,
        lastModified: loaded.fetched.lastModified,
        lastFetchedAt: this.now().toISOString(),
        lastSuccessAt: this.now().toISOString(),
        nextFetchAt: this.nextFetch(
          existing?.refreshIntervalMinutes ?? DEFAULT_REFRESH_MINUTES,
        ),
        fetchError: null,
        failureCount: 0,
        refreshIntervalMinutes: existing?.refreshIntervalMinutes,
        defaultSpeed: existing?.defaultSpeed,
        skipIntroSeconds: existing?.skipIntroSeconds,
        skipOutroSeconds: existing?.skipOutroSeconds,
        autoQueue: existing?.autoQueue,
        episodeSort: existing?.episodeSort,
        defaultMediaForm: existing?.defaultMediaForm,
        subscribed: true,
      });
      const saved = await this.database.savePodcastEpisodes(
        feed.id,
        loaded.parsed.episodes.map((episode) =>
          toEpisodeUpsert(
            feed.id,
            episode,
            this.now().toISOString(),
            feed.defaultMediaForm,
          ),
        ),
      );
      this.options.logger.info('podcast.feed.added', {
        feedId: feed.id,
        host: redactUrlForLog(feed.feedUrl),
        episodes: saved.length,
        truncated: loaded.parsed.truncated,
        dropped: loaded.parsed.dropped,
      });
      this.emit({ type: 'feeds', feedId: feed.id, reason: 'added' });
      this.emit({ type: 'episodes', feedId: feed.id, reason: 'refreshed' });
      return ok(toPodcastFeed(feed));
    } catch (error) {
      this.options.logger.warn('podcast.feed.add.failed', {
        host: redactUrlForLog(normalized),
        error: errorMessage(error),
      });
      return failFromError(error);
    }
  }

  async updateFeed(
    feedId: string,
    patch: PodcastFeedPatch,
  ): Promise<Result<PodcastFeed>> {
    if (!feedId) return fail('INVALID_ARGUMENT', 'feedId is required');
    const invalid = validatePatch(patch);
    if (invalid) return fail('INVALID_ARGUMENT', invalid);
    try {
      const updated = await this.database.updatePodcastFeed(feedId, patch);
      this.emit({ type: 'feeds', feedId, reason: 'updated' });
      return ok(toPodcastFeed(updated));
    } catch (error) {
      return fail('DATABASE_ERROR', errorMessage(error));
    }
  }

  async removeFeed(
    feedId: string,
    options: { deleteDownloads?: boolean } = {},
  ): Promise<Result<{ removed: boolean }>> {
    if (!feedId) return fail('INVALID_ARGUMENT', 'feedId is required');
    const removed = await this.database.removePodcastFeed(feedId);
    if (removed) {
      this.options.logger.info('podcast.feed.removed', {
        feedId,
        deleteDownloads: options.deleteDownloads === true,
      });
      this.emit({ type: 'feeds', feedId, reason: 'removed' });
    }
    return ok({ removed });
  }

  async listEpisodes(
    feedId: string,
    options: { limit?: number; offset?: number; sort?: 'newest' | 'oldest' } = {},
  ): Promise<PodcastEpisode[]> {
    const episodes = await this.database.listPodcastEpisodes(feedId, options);
    return episodes.map(toPodcastEpisode);
  }

  async getEpisode(episodeId: string): Promise<PodcastEpisode | null> {
    const episode = await this.database.getPodcastEpisode(episodeId);
    return episode ? toPodcastEpisode(episode) : null;
  }

  async setPlayed(episodeId: string, played: boolean): Promise<Result<PodcastEpisode>> {
    if (!episodeId) return fail('INVALID_ARGUMENT', 'episodeId is required');
    await this.database.setPodcastEpisodePlayed(episodeId, played);
    const episode = await this.database.getPodcastEpisode(episodeId);
    if (!episode) return fail('TRACK_NOT_FOUND', 'The episode does not exist');
    this.emit({ type: 'episodes', feedId: episode.feedId, reason: 'played' });
    return ok(toPodcastEpisode(episode));
  }

  async refresh(feedId?: string): Promise<PodcastRefreshSummary> {
    const feeds = feedId
      ? [await this.database.getPodcastFeed(feedId)]
      : (await this.database.listPodcastFeeds()).filter((feed) => feed.subscribed);
    const selected = feeds.filter((feed): feed is StoredPodcastFeed => feed !== null);
    if (feedId && selected.length === 0) {
      return {
        feedId,
        refreshed: 0,
        newEpisodes: 0,
        failed: 1,
        errors: [{ feedId, message: 'The feed does not exist' }],
      };
    }
    return this.refreshMany(selected, feedId ?? null);
  }

  async refreshDue(): Promise<PodcastRefreshSummary> {
    const due = await this.database.listDuePodcastFeeds(this.now().toISOString());
    return this.refreshMany(due, null);
  }

  async importOpmlText(
    xml: string,
    options: ImportOpmlOptions = {},
  ): Promise<PodcastImportSummary> {
    const parsed = parseOpml(xml, {
      allowLocalNetwork: this.options.allowLocalNetwork(),
    });
    const feeds: PodcastFeed[] = [];
    let duplicates = 0;
    const now = this.now().toISOString();
    for (const entry of parsed.feeds) {
      const existing = await this.database.getPodcastFeedByUrl(entry.feedUrl);
      if (existing) {
        duplicates += 1;
        continue;
      }
      const stored = await this.database.upsertPodcastFeed({
        feedUrl: entry.feedUrl,
        siteUrl: entry.siteUrl,
        title: entry.title ?? entry.feedUrl,
        feedType: 'rss',
        nextFetchAt: now,
        subscribed: true,
      });
      feeds.push(toPodcastFeed(stored));
    }
    this.options.logger.info('podcast.opml.imported', {
      added: feeds.length,
      duplicates,
      invalid: parsed.invalid,
      truncated: parsed.truncated,
    });
    if (options.refresh !== false && feeds.length > 0) {
      const ids = feeds.map((feed) => feed.id);
      void this.refreshIds(ids);
    }
    return {
      added: feeds.length,
      duplicates,
      invalid: parsed.invalid,
      scheduled: feeds.length,
      feeds,
    };
  }

  async exportOpmlText(): Promise<string> {
    const feeds = (await this.database.listPodcastFeeds())
      .filter((feed) => feed.subscribed)
      .map((feed) => ({
        title: feed.title,
        feedUrl: feed.feedUrl,
        siteUrl: feed.siteUrl,
      }));
    return serializeOpml(feeds, 'Statocyst Podcasts');
  }

  async directoryStatus(): Promise<PodcastDirectoryStatus> {
    const providers: PodcastDirectoryStatus['providers'] = ['apple', 'fyyd'];
    if (this.options.directoryCredentials) providers.push('podcast-index');
    return { configured: true, provider: 'multiple', providers };
  }

  async setDirectoryCredentials(
    apiKey: string,
    secret: string,
  ): Promise<Result<PodcastDirectoryStatus>> {
    if (!apiKey.trim() || !secret.trim()) {
      return fail('INVALID_ARGUMENT', 'Both the Podcast Index key and secret are required');
    }
    if (!(await this.options.codec.isAvailable())) {
      return fail(
        'INTERNAL_ERROR',
        'Secure credential storage is unavailable, so Podcast Index search is disabled',
      );
    }
    try {
      const ciphertext = {
        apiKey: await this.options.codec.encrypt(apiKey.trim()),
        secret: await this.options.codec.encrypt(secret.trim()),
      };
      await this.database.setAppState(DIRECTORY_CREDENTIALS_KEY, JSON.stringify(ciphertext));
      this.options.logger.info('podcast.directory.credentials.saved');
      return ok({ configured: true, provider: 'multiple', providers: ['apple', 'fyyd'] });
    } catch (error) {
      this.options.logger.warn('podcast.directory.credentials.save-failed', {
        error: errorMessage(error),
      });
      return fail('INTERNAL_ERROR', 'Podcast Index credentials could not be stored securely');
    }
  }

  async clearDirectoryCredentials(): Promise<void> {
    await this.database.removeAppState(DIRECTORY_CREDENTIALS_KEY);
    this.options.logger.info('podcast.directory.credentials.cleared');
  }

  async searchDirectory(query: string): Promise<Result<PodcastSearchResult[]>> {
    const trimmed = query.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      return fail('INVALID_ARGUMENT', 'Search query must be 1–200 characters');
    }
    const cacheKey = trimmed.toLowerCase();
    const cached = await this.database.getPodcastDirectoryCache(
      DIRECTORY_PROVIDER,
      cacheKey,
    );
    if (cached && Date.parse(cached.expiresAt) > this.now().getTime()) {
      try {
        return ok(JSON.parse(cached.payloadJson) as PodcastSearchResult[]);
      } catch {
        /* fall through to a fresh request */
      }
    }

    const errors: string[] = [];
    const results: PodcastSearchResult[] = [];
    const encoded = encodeURIComponent(trimmed);
    const appleBase = (this.options.appleSearchBaseUrl ?? 'https://itunes.apple.com/search').replace(/\/+$/, '');
    const fyydBase = (this.options.fyydSearchBaseUrl ?? 'https://api.fyyd.de/0.2/search/podcast').replace(/\/+$/, '');
    const [apple, fyyd] = await Promise.allSettled([
      this.fetchDirectoryJson(
        `${appleBase}?term=${encoded}&media=podcast&entity=podcast&limit=40&country=US`,
      ).then((payload) => parseAppleSearch(payload, { allowLocalNetwork: this.options.allowLocalNetwork() })),
      this.fetchDirectoryJson(`${fyydBase}?term=${encoded}&count=30`).then((payload) =>
        parseFyydSearch(payload, { allowLocalNetwork: this.options.allowLocalNetwork() }),
      ),
    ]);
    if (apple.status === 'fulfilled') results.push(...apple.value);
    else errors.push(`Apple: ${errorMessage(apple.reason)}`);
    if (fyyd.status === 'fulfilled') results.push(...fyyd.value);
    else errors.push(`Fyyd: ${errorMessage(fyyd.reason)}`);

    if (this.options.directoryCredentials) {
      try {
        const index = await this.options.directory.search(
          trimmed,
          this.options.directoryCredentials,
        );
        results.push(
          ...index.map((result) => ({
            ...result,
            source: 'podcast-index' as const,
          })),
        );
      } catch (error) {
        errors.push(`Podcast Index: ${errorMessage(error)}`);
      }
    }

    const merged = dedupeDirectoryResults(results);
    if (merged.length === 0 && errors.length > 0) {
      this.options.logger.warn('podcast.directory.search.failed', {
        query: trimmed,
        errors,
      });
      return fail('MEDIA_UNAVAILABLE', 'No podcast directory returned results');
    }
    await this.database.savePodcastDirectoryCache({
      provider: DIRECTORY_PROVIDER,
      queryKey: cacheKey,
      payloadJson: JSON.stringify(merged),
      fetchedAt: this.now().toISOString(),
      expiresAt: new Date(this.now().getTime() + DIRECTORY_CACHE_MS).toISOString(),
    });
    return ok(merged);
  }

  /**
   * Discovery landing: Apple's top-show chart resolved to feed URLs, plus the
   * categories carried by those shows. Cached separately from search results.
   */
  async discoverDirectory(): Promise<Result<PodcastDiscovery>> {
    const cacheKey = 'top-chart';
    const cached = await this.database.getPodcastDirectoryCache(DIRECTORY_PROVIDER, cacheKey);
    const cacheFresh = !!cached && Date.parse(cached.expiresAt) > this.now().getTime();
    if (cacheFresh && cached) {
      try {
        return ok(JSON.parse(cached.payloadJson) as PodcastDiscovery);
      } catch {
        /* fall through to a fresh request */
      }
    }

    try {
      const topUrl = this.options.appleTopUrl ?? APPLE_TOP_URL;
      const topPayload = await this.fetchDirectoryJson(topUrl);
      const chart = parseAppleTopCharts(topPayload);
      let lookupPayload: unknown = null;
      const ids = chart.slice(0, 50).map((entry) => entry.providerId);
      if (ids.length > 0) {
        const lookupBase = (this.options.appleLookupBaseUrl ?? APPLE_LOOKUP_BASE).replace(
          /\/+$/,
          '',
        );
        try {
          lookupPayload = await this.fetchDirectoryJson(
            `${lookupBase}?id=${ids.join(',')}&entity=podcast&country=US`,
          );
        } catch (error) {
          // The chart still yields categories even when feed resolution fails.
          this.options.logger.warn('podcast.discover.lookup-failed', {
            error: errorMessage(error),
          });
        }
      }

      const discovery = buildPodcastDiscovery(topPayload, lookupPayload, {
        allowLocalNetwork: this.options.allowLocalNetwork(),
      });
      if (discovery.top.length === 0 && discovery.categories.length === 0) {
        return fail('MEDIA_UNAVAILABLE', 'The podcast directory returned no discovery data');
      }
      await this.database.savePodcastDirectoryCache({
        provider: DIRECTORY_PROVIDER,
        queryKey: cacheKey,
        payloadJson: JSON.stringify(discovery),
        fetchedAt: this.now().toISOString(),
        expiresAt: new Date(this.now().getTime() + DISCOVERY_CACHE_MS).toISOString(),
      });
      return ok(discovery);
    } catch (error) {
      this.options.logger.warn('podcast.discover.failed', { error: errorMessage(error) });
      if (cached) {
        try {
          return ok(JSON.parse(cached.payloadJson) as PodcastDiscovery);
        } catch {
          /* fall through */
        }
      }
      return fail('MEDIA_UNAVAILABLE', 'The podcast directory is unavailable right now');
    }
  }

  private async fetchDirectoryJson(url: string): Promise<unknown> {
    const response = await this.options.fetcher.fetchText(url, {
      accept: 'application/json',
      allowHtml: false,
      allowJson: true,
      maxBytes: 2 * 1024 * 1024,
    });
    if (!response.body) throw new Error('The directory response was empty');
    return JSON.parse(response.body);
  }

  private async refreshMany(
    feeds: StoredPodcastFeed[],
    requestedFeedId: string | null,
  ): Promise<PodcastRefreshSummary> {
    const results: Array<{ feedId: string; newEpisodes: number; error: string | null }> = [];
    let index = 0;
    const workers = Array.from({ length: Math.min(3, Math.max(1, feeds.length)) }, async () => {
      for (;;) {
        const current = index;
        index += 1;
        const feed = feeds[current];
        if (!feed) return;
        const result = await this.refreshOne(feed);
        results.push(result);
      }
    });
    await Promise.all(workers);
    const failures = results.filter((result) => result.error !== null);
    return {
      feedId: requestedFeedId,
      refreshed: results.length - failures.length,
      newEpisodes: results.reduce((total, result) => total + result.newEpisodes, 0),
      failed: failures.length,
      errors: failures.map((result) => ({
        feedId: result.feedId,
        message: result.error ?? 'Refresh failed',
      })),
    };
  }

  private async refreshIds(ids: readonly string[]): Promise<void> {
    const feeds = (
      await Promise.all(ids.map((id) => this.database.getPodcastFeed(id)))
    ).filter((feed): feed is StoredPodcastFeed => feed !== null);
    await this.refreshMany(feeds, null);
  }

  private async refreshOne(
    feed: StoredPodcastFeed,
  ): Promise<{ feedId: string; newEpisodes: number; error: string | null }> {
    try {
      const fetched = await this.options.fetcher.fetchText(
        feed.resolvedUrl ?? feed.feedUrl,
        {
          etag: feed.etag,
          lastModified: feed.lastModified,
          allowHtml: false,
        },
      );
      if (fetched.status === 304) {
        await this.database.updatePodcastFeedFetchState(feed.id, {
          lastFetchedAt: this.now().toISOString(),
          lastSuccessAt: this.now().toISOString(),
          nextFetchAt: this.nextFetch(feed.refreshIntervalMinutes),
          fetchError: null,
          failureCount: 0,
        });
        return { feedId: feed.id, newEpisodes: 0, error: null };
      }
      const parsed = await parsePodcastFeed(fetched.body ?? '', {
        feedUrl: feed.feedUrl,
        resolvedUrl: fetched.finalUrl,
        allowLocalNetwork: this.options.allowLocalNetwork(),
      });
      const artworkPath =
        feed.artworkPath ?? (await this.cacheArtwork(parsed.imageUrl));
      const updated = await this.database.upsertPodcastFeed({
        feedUrl: feed.feedUrl,
        resolvedUrl: parsed.resolvedUrl,
        siteUrl: parsed.siteUrl,
        title: parsed.title,
        author: parsed.author,
        descriptionText: parsed.descriptionText,
        imageUrl: parsed.imageUrl,
        artworkPath,
        language: parsed.language,
        explicit: parsed.explicit,
        categories: parsed.categories,
        feedType: parsed.feedType,
        podcastIndexId: parsed.podcastIndexId,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        lastFetchedAt: this.now().toISOString(),
        lastSuccessAt: this.now().toISOString(),
        nextFetchAt: this.nextFetch(feed.refreshIntervalMinutes),
        fetchError: null,
        failureCount: 0,
      });
      const saved = await this.database.savePodcastEpisodes(
        updated.id,
        parsed.episodes.map((episode) =>
          toEpisodeUpsert(
            updated.id,
            episode,
            this.now().toISOString(),
            updated.defaultMediaForm,
          ),
        ),
      );
      const newEpisodes = saved.filter((episode) => !episode.duplicate).length;
      this.options.logger.info('podcast.feed.refreshed', {
        feedId: feed.id,
        host: redactUrlForLog(feed.feedUrl),
        newEpisodes,
        total: saved.length,
        truncated: parsed.truncated,
        dropped: parsed.dropped,
      });
      if (newEpisodes > 0 || saved.length > 0) {
        this.emit({ type: 'episodes', feedId: feed.id, reason: 'refreshed' });
      }
      return { feedId: feed.id, newEpisodes, error: null };
    } catch (error) {
      const failureCount = feed.failureCount + 1;
      const message = errorMessage(error);
      await this.database
        .updatePodcastFeedFetchState(feed.id, {
          lastFetchedAt: this.now().toISOString(),
          nextFetchAt: this.nextFetch(feed.refreshIntervalMinutes, failureCount),
          fetchError: message,
          failureCount,
        })
        .catch(() => undefined);
      this.options.logger.warn('podcast.feed.refresh.failed', {
        feedId: feed.id,
        host: redactUrlForLog(feed.feedUrl),
        failureCount,
        error: message,
      });
      return { feedId: feed.id, newEpisodes: 0, error: message };
    }
  }

  private async loadFeed(url: string): Promise<{
    parsed: Awaited<ReturnType<typeof parsePodcastFeed>>;
    fetched: FetchedText;
  }> {
    let fetched = await this.options.fetcher.fetchText(url, {
      allowHtml: true,
    });
    if (!fetched.body) {
      throw new PodcastFetchError('EMPTY_BODY', 'The feed response is empty');
    }
    if ((fetched.contentType ?? '').toLowerCase() === 'text/html') {
      const discovered = discoverFeedUrls(fetched.body, fetched.finalUrl);
      if (discovered.length === 0) {
        throw new PodcastFetchError(
          'UNSUPPORTED_CONTENT_TYPE',
          'No RSS or Atom feed was found on that page',
        );
      }
      if (discovered.length > 1) {
        this.options.logger.info('podcast.feed.discovery.multiple', {
          host: redactUrlForLog(url),
          candidates: discovered.length,
        });
      }
      fetched = await this.options.fetcher.fetchText(discovered[0], {
        allowHtml: false,
      });
      if (!fetched.body) {
        throw new PodcastFetchError('EMPTY_BODY', 'The feed response is empty');
      }
    }
    const parsed = await parsePodcastFeed(fetched.body, {
      feedUrl: url,
      resolvedUrl: fetched.finalUrl,
      allowLocalNetwork: this.options.allowLocalNetwork(),
    });
    return { parsed, fetched };
  }

  private validArtworkUrl(value: string | null): string | null {
    if (!value) return null;
    const checked = checkHttpUrl(value, {
      allowLocalNetwork: this.options.allowLocalNetwork(),
    });
    return checked.ok ? checked.url.toString() : null;
  }

  /** Cache a directory image and expose it through the artwork protocol. */
  async cacheDirectoryArtwork(url: string): Promise<Result<{ url: string | null }>> {
    const trimmed = url.trim();
    if (!trimmed) return ok({ url: null });
    const path = await this.cacheArtwork(trimmed);
    if (!path) return ok({ url: null });
    return ok({ url: `statocyst-art://image/${basename(path)}` });
  }

  private async cacheArtwork(imageUrl: string | null): Promise<string | null> {
    if (!imageUrl) return null;
    const checked = checkHttpUrl(imageUrl, {
      allowLocalNetwork: this.options.allowLocalNetwork(),
    });
    if (!checked.ok) return null;
    try {
      const binary = await this.options.fetcher.fetchBinary(imageUrl, 'image/*');
      const extension = imageExtension(binary.contentType);
      const hash = createHash('sha256').update(imageUrl).digest('hex').slice(0, 32);
      await mkdir(this.options.artworkDirectory, { recursive: true });
      const target = join(this.options.artworkDirectory, `podcast-${hash}.${extension}`);
      await writeFile(target, binary.body);
      return target;
    } catch (error) {
      this.options.logger.warn('podcast.artwork.cache-failed', {
        host: redactUrlForLog(imageUrl),
        error: errorMessage(error),
      });
      return null;
    }
  }

  private async loadDirectoryCredentials(): Promise<{
    apiKey: string;
    secret: string;
  } | null> {
    const raw = await this.database.getAppState(DIRECTORY_CREDENTIALS_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { apiKey?: string; secret?: string };
      if (!parsed.apiKey || !parsed.secret) return null;
      return {
        apiKey: await this.options.codec.decrypt(parsed.apiKey),
        secret: await this.options.codec.decrypt(parsed.secret),
      };
    } catch {
      this.options.logger.warn('podcast.directory.credentials.unreadable');
      return null;
    }
  }

  private nextFetch(intervalMinutes: number, failureCount = 0): string {
    const minutes = Math.max(
      MIN_REFRESH_MINUTES,
      Math.min(MAX_REFRESH_MINUTES, intervalMinutes || DEFAULT_REFRESH_MINUTES),
    );
    const base = minutes * 60_000;
    const backoff =
      failureCount > 0 ? Math.min(24 * 60 * 60_000, base * 2 ** Math.min(failureCount, 6)) : base;
    const jitter = backoff * 0.1 * Math.random();
    return new Date(this.now().getTime() + backoff + jitter).toISOString();
  }

  private emit(event: PodcastChangeEvent): void {
    this.options.onChanged?.(event);
  }
}

function toPodcastFeed(feed: StoredPodcastFeed): PodcastFeed {
  return {
    id: feed.id,
    feedUrl: feed.feedUrl,
    siteUrl: feed.siteUrl,
    title: feed.title,
    author: feed.author,
    descriptionText: feed.descriptionText,
    imageUrl: feed.imageUrl,
    artworkUrl: feed.artworkPath ? `statocyst-art://feed/${feed.id}` : null,
    language: feed.language,
    explicit: feed.explicit,
    categories: feed.categories,
    subscribed: feed.subscribed,
    refreshIntervalMinutes: feed.refreshIntervalMinutes,
    defaultSpeed: feed.defaultSpeed,
    skipIntroSeconds: feed.skipIntroSeconds,
    skipOutroSeconds: feed.skipOutroSeconds,
    autoQueue: feed.autoQueue,
    episodeSort: feed.episodeSort,
    defaultMediaForm: feed.defaultMediaForm,
    lastFetchedAt: feed.lastFetchedAt,
    lastSuccessAt: feed.lastSuccessAt,
    etag: feed.etag,
    lastModified: feed.lastModified,
    fetchError: feed.fetchError,
    unplayedCount: feed.unplayedCount,
    newEpisodeCount: feed.newEpisodeCount,
  };
}

function toPodcastEpisode(episode: StoredPodcastEpisode): PodcastEpisode {
  return {
    id: episode.id,
    episodeId: episode.episodeId,
    title: episode.title,
    artist: episode.artist,
    album: episode.album,
    albumArtist: episode.albumArtist,
    durationMs: episode.durationMs,
    artworkUrl: episode.artworkUrl,
    sourceId: episode.sourceId,
    sourceLabel: episode.sourceLabel,
    sourceKind: 'podcast',
    mediaKind: 'podcast',
    mediaForm: episode.mediaForm,
    trackNo: episode.trackNo,
    year: episode.year,
    genre: episode.genre,
    format: episode.format,
    sizeBytes: episode.sizeBytes,
    bitrate: episode.bitrate,
    missing: episode.missing,
    feedId: episode.feedId,
    feedTitle: episode.feedTitle,
    guid: episode.guid,
    descriptionText: episode.descriptionText,
    links: episode.links,
    link: episode.link,
    publishedAt: episode.publishedAt,
    seasonNo: episode.seasonNo,
    episodeNo: episode.episodeNo,
    episodeType: episode.episodeType,
    explicit: episode.explicit,
    enclosureUrl: episode.enclosureUrl,
    enclosureType: episode.enclosureType,
    alternates: episode.alternates,
    posterUrl: episode.posterUrl,
    videoWidth: episode.videoWidth,
    videoHeight: episode.videoHeight,
    playbackSpeed: episode.playbackSpeed,
    resumePositionMs: episode.resumePositionMs,
    played: episode.played,
    completed: episode.completed,
    playCount: episode.playCount,
    lastPlayedAt: episode.lastPlayedAt,
  };
}

function toEpisodeUpsert(
  feedId: string,
  episode: Awaited<ReturnType<typeof parsePodcastFeed>>['episodes'][number],
  firstSeenAt: string,
  preferredForm: MediaForm,
): PodcastEpisodeUpsert {
  let mediaForm = episode.mediaForm;
  let enclosureUrl = episode.enclosureUrl;
  let enclosureType = episode.enclosureType;
  let enclosureLengthBytes = episode.enclosureLengthBytes;
  let videoWidth = episode.videoWidth;
  let videoHeight = episode.videoHeight;
  let alternates = episode.alternates;
  if (preferredForm === 'video' && mediaForm === 'audio') {
    const video = episode.alternates.find((alternate) => alternate.form === 'video');
    if (video) {
      const previousPrimary = {
        url: enclosureUrl,
        type: enclosureType,
        form: mediaForm,
        lengthBytes: enclosureLengthBytes,
        width: null,
        height: null,
        bitrate: null,
      } as const;
      mediaForm = 'video';
      enclosureUrl = video.url;
      enclosureType = video.type;
      enclosureLengthBytes = video.lengthBytes;
      videoWidth = video.width;
      videoHeight = video.height;
      alternates = [
        previousPrimary,
        ...episode.alternates.filter((alternate) => alternate.url !== video.url),
      ].slice(0, 8);
    }
  }
  return {
    feedId,
    guid: episode.guid,
    pathKey: episode.pathKey,
    title: episode.title,
    descriptionText: episode.descriptionText,
    links: episode.links,
    link: episode.link,
    enclosureUrl,
    enclosureType,
    enclosureLengthBytes,
    mediaForm,
    alternates,
    posterUrl: episode.posterUrl,
    videoWidth,
    videoHeight,
    durationMs: episode.durationMs,
    publishedAt: episode.publishedAt,
    seasonNo: episode.seasonNo,
    episodeNo: episode.episodeNo,
    episodeType: episode.episodeType,
    imageUrl: episode.imageUrl,
    explicit: episode.explicit,
    chaptersUrl: episode.chaptersUrl,
    transcriptUrl: episode.transcriptUrl,
    transcriptType: episode.transcriptType,
    firstSeenAt,
  };
}

function validatePatch(patch: PodcastFeedPatch): string | null {
  if (
    patch.refreshIntervalMinutes !== undefined &&
    (!Number.isFinite(patch.refreshIntervalMinutes) ||
      patch.refreshIntervalMinutes < MIN_REFRESH_MINUTES ||
      patch.refreshIntervalMinutes > MAX_REFRESH_MINUTES)
  ) {
    return `Refresh interval must be ${MIN_REFRESH_MINUTES}–${MAX_REFRESH_MINUTES} minutes`;
  }
  if (
    patch.defaultSpeed !== undefined &&
    (!Number.isFinite(patch.defaultSpeed) ||
      patch.defaultSpeed < 0.5 ||
      patch.defaultSpeed > 3)
  ) {
    return 'Playback speed must be between 0.5 and 3';
  }
  for (const value of [patch.skipIntroSeconds, patch.skipOutroSeconds]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 300)) {
      return 'Skip intervals must be between 0 and 300 seconds';
    }
  }
  if (
    patch.episodeSort !== undefined &&
    patch.episodeSort !== 'newest' &&
    patch.episodeSort !== 'oldest'
  ) {
    return 'Episode sort must be newest or oldest';
  }
  if (
    patch.defaultMediaForm !== undefined &&
    patch.defaultMediaForm !== 'audio' &&
    patch.defaultMediaForm !== 'video'
  ) {
    return 'Default media form must be audio or video';
  }
  return null;
}

function failFromError<T>(error: unknown): Result<T> {
  if (error instanceof PodcastFetchError) {
    const code: ErrorCode =
      error.code === 'INVALID_URL' || error.code === 'BLOCKED'
        ? 'INVALID_ARGUMENT'
        : 'MEDIA_UNAVAILABLE';
    return fail(code, error.message);
  }
  if (error instanceof PodcastParseError) {
    return fail('INVALID_ARGUMENT', error.message);
  }
  if (error instanceof PodcastDirectoryError) {
    return fail(
      error.code === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : 'MEDIA_UNAVAILABLE',
      error.message,
    );
  }
  return fail('INTERNAL_ERROR', errorMessage(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function imageExtension(contentType: string | null): string {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('svg')) return 'svg';
  return 'jpg';
}

function discoverFeedUrls(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const tagPattern = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html)) !== null) {
    const tag = match[0];
    const rel = attributeOf(tag, 'rel')?.toLowerCase() ?? '';
    const type = attributeOf(tag, 'type')?.toLowerCase() ?? '';
    if (!rel.split(/\s+/).includes('alternate')) continue;
    if (!type.includes('rss') && !type.includes('atom') && !type.endsWith('+xml')) continue;
    const href = attributeOf(tag, 'href');
    if (!href) continue;
    const resolved = resolveHttpUrl(decodeEntities(href), baseUrl);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      found.push(resolved);
    }
  }
  return found;
}

function attributeOf(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = pattern.exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}
