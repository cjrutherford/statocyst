import type {
  PodcastBridge,
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
  Settings,
} from '@statocyst/contracts';
import { fail, ok } from '@statocyst/contracts';
import {
  dedupeDirectoryResults,
  buildPodcastDiscovery,
  normalizeFeedUrl,
  parseAppleSearch,
  parseAppleTopCharts,
  parseFyydSearch,
  parseOpml,
  parsePodcastFeed,
  resolveHttpUrl,
  serializeOpml,
} from '@statocyst/podcast-core';

interface NativePodcastOptions {
  plugin: () => any;
  settings: () => Promise<Settings>;
  rememberTracks?: (episodes: PodcastEpisode[]) => void;
}

const EMPTY_IMPORT: PodcastImportSummary = {
  added: 0,
  duplicates: 0,
  invalid: 0,
  scheduled: 0,
  feeds: [],
};

/** Capacitor implementation of the podcast bridge. Parsing stays in the shared TS core. */
export function createCapacitorPodcastBridge(options: NativePodcastOptions): PodcastBridge {
  const listeners = new Set<(event: PodcastChangeEvent) => void>();
  const plugin = () => options.plugin();

  const emit = (event: PodcastChangeEvent): void => {
    for (const listener of listeners) listener(event);
  };

  async function allowLocal(): Promise<boolean> {
    try {
      return (await options.settings()).podcastAllowLocalNetwork;
    } catch {
      return false;
    }
  }

  async function listFeeds(): Promise<PodcastFeed[]> {
    const result = await plugin()?.listPodcastFeeds?.();
    return Array.isArray(result?.feeds) ? (result.feeds as PodcastFeed[]) : [];
  }

  async function listEpisodes(feedId: string): Promise<PodcastEpisode[]> {
    const result = await plugin()?.listPodcastEpisodes?.({ feedId });
    const episodes = Array.isArray(result?.episodes) ? (result.episodes as PodcastEpisode[]) : [];
    options.rememberTracks?.(episodes);
    return episodes;
  }

  async function cacheArtwork(url: string | null): Promise<string | null> {
    if (!url) return null;
    try {
      const result = await plugin()?.cachePodcastArtwork?.({
        url,
        allowLocalNetwork: await allowLocal(),
      });
      return typeof result?.path === 'string' ? result.path : null;
    } catch {
      return null;
    }
  }

  async function saveFeed(
    feed: Record<string, unknown>,
    episodes: unknown[],
  ): Promise<PodcastFeed> {
    const result = await plugin()?.savePodcastFeed?.({
      feedJson: JSON.stringify(feed),
      episodesJson: JSON.stringify(episodes),
    });
    if (!result?.feed) throw new Error('The native podcast store did not return the feed');
    return result.feed as PodcastFeed;
  }

  async function feedPayload(
    existing: PodcastFeed | null,
    parsed: Awaited<ReturnType<typeof parsePodcastFeed>>,
    fetched: { etag: string | null; lastModified: string | null },
    artworkPath: string | null,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const now = new Date();
    return {
      feedUrl: existing?.feedUrl ?? parsed.feedUrl,
      resolvedUrl: parsed.resolvedUrl,
      siteUrl: parsed.siteUrl,
      title: parsed.title,
      author: parsed.author,
      descriptionText: parsed.descriptionText,
      imageUrl: parsed.imageUrl,
      artworkPath: artworkPath ?? undefined,
      language: parsed.language,
      explicit: parsed.explicit,
      categories: parsed.categories,
      feedType: parsed.feedType,
      podcastIndexId: parsed.podcastIndexId,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      lastFetchedAt: now.toISOString(),
      lastSuccessAt: now.toISOString(),
      nextFetchAt: nextFetch(existing?.refreshIntervalMinutes ?? 60),
      fetchError: null,
      failureCount: 0,
      refreshIntervalMinutes: existing?.refreshIntervalMinutes,
      defaultSpeed: existing?.defaultSpeed,
      skipIntroSeconds: existing?.skipIntroSeconds,
      skipOutroSeconds: existing?.skipOutroSeconds,
      autoQueue: existing?.autoQueue,
      episodeSort: existing?.episodeSort,
      subscribed: existing?.subscribed ?? true,
      ...overrides,
    };
  }

  async function loadFeed(url: string): Promise<{
    parsed: Awaited<ReturnType<typeof parsePodcastFeed>>;
    fetched: { finalUrl: string; etag: string | null; lastModified: string | null };
  }> {
    const allowLocalNetwork = await allowLocal();
    let fetched = await plugin()?.fetchPodcastText?.({
      url,
      allowLocalNetwork,
      allowHtml: true,
    });
    if (!fetched?.body) throw new Error('The feed response is empty');
    if (String(fetched.contentType ?? '').toLowerCase() === 'text/html') {
      const discovered = discoverFeedUrls(String(fetched.body), String(fetched.finalUrl ?? url));
      if (discovered.length === 0) throw new Error('No RSS or Atom feed was found on that page');
      fetched = await plugin()?.fetchPodcastText?.({
        url: discovered[0],
        allowLocalNetwork,
        allowHtml: false,
      });
      if (!fetched?.body) throw new Error('The feed response is empty');
    }
    const parsed = await parsePodcastFeed(String(fetched.body), {
      feedUrl: url,
      resolvedUrl: String(fetched.finalUrl ?? url),
      allowLocalNetwork,
    });
    return {
      parsed,
      fetched: {
        finalUrl: String(fetched.finalUrl ?? url),
        etag: typeof fetched.etag === 'string' ? fetched.etag : null,
        lastModified: typeof fetched.lastModified === 'string' ? fetched.lastModified : null,
      },
    };
  }

  async function refreshFeed(feed: PodcastFeed): Promise<{
    newEpisodes: number;
    error: string | null;
  }> {
    const allowLocalNetwork = await allowLocal();
    try {
      const fetched = await plugin()?.fetchPodcastText?.({
        url: feed.feedUrl,
        allowLocalNetwork,
        allowHtml: false,
        etag: feed.etag ?? null,
        lastModified: feed.lastModified ?? null,
      });
      if (!fetched?.body) throw new Error('The feed response is empty');
      const parsed = await parsePodcastFeed(String(fetched.body), {
        feedUrl: feed.feedUrl,
        resolvedUrl: String(fetched.finalUrl ?? feed.feedUrl),
        allowLocalNetwork,
      });
      const before = new Set((await listEpisodes(feed.id)).map((episode) => episode.guid));
      const artworkPath = feed.artworkUrl ? null : await cacheArtwork(parsed.imageUrl);
      const payload = await feedPayload(
        feed,
        parsed,
        {
          etag: typeof fetched.etag === 'string' ? fetched.etag : null,
          lastModified:
            typeof fetched.lastModified === 'string' ? fetched.lastModified : null,
        },
        artworkPath,
      );
      await saveFeed(payload, parsed.episodes);
      emit({ type: 'episodes', feedId: feed.id, reason: 'refreshed' });
      return {
        newEpisodes: parsed.episodes.filter((episode) => !before.has(episode.guid)).length,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureCount = 1;
      await saveFeed(
        {
          feedUrl: feed.feedUrl,
          title: feed.title,
          author: feed.author,
          descriptionText: feed.descriptionText,
          imageUrl: feed.imageUrl,
          language: feed.language,
          explicit: feed.explicit,
          categories: feed.categories,
          feedType: 'rss',
          lastFetchedAt: new Date().toISOString(),
          nextFetchAt: nextFetch(feed.refreshIntervalMinutes, failureCount),
          fetchError: message,
          failureCount,
          refreshIntervalMinutes: feed.refreshIntervalMinutes,
          defaultSpeed: feed.defaultSpeed,
          skipIntroSeconds: feed.skipIntroSeconds,
          skipOutroSeconds: feed.skipOutroSeconds,
          autoQueue: feed.autoQueue,
          episodeSort: feed.episodeSort,
          subscribed: feed.subscribed,
        },
        [],
      ).catch(() => undefined);
      return { newEpisodes: 0, error: message };
    }
  }

  const bridge: PodcastBridge = {
    listFeeds,
    async addFeed(
      url: string,
      options: { artworkUrl?: string | null } = {},
    ): Promise<Result<PodcastFeed>> {
      const normalized = normalizeFeedUrl(url, { allowLocalNetwork: await allowLocal() });
      if (!normalized) return fail('INVALID_ARGUMENT', 'The feed URL is invalid or blocked');
      try {
        const loaded = await loadFeed(normalized);
        const directoryArtwork = options.artworkUrl ?? null;
        const directoryArtworkPath = await cacheArtwork(directoryArtwork);
        const existing = (await listFeeds()).find((feed) => feed.feedUrl === normalized) ?? null;
        const artworkPath =
          directoryArtworkPath ?? (await cacheArtwork(loaded.parsed.imageUrl));
        const imageUrl = directoryArtworkPath
          ? (directoryArtwork ?? loaded.parsed.imageUrl)
          : loaded.parsed.imageUrl;
        const payload = await feedPayload(existing, loaded.parsed, loaded.fetched, artworkPath, {
          imageUrl,
        });
        const feed = await saveFeed(payload, loaded.parsed.episodes);
        emit({ type: 'feeds', feedId: feed.id, reason: 'added' });
        emit({ type: 'episodes', feedId: feed.id, reason: 'refreshed' });
        return ok(feed);
      } catch (error) {
        return fail('MEDIA_UNAVAILABLE', error instanceof Error ? error.message : String(error));
      }
    },
    async updateFeed(feedId: string, patch: PodcastFeedPatch): Promise<Result<PodcastFeed>> {
      try {
        const result = await plugin()?.updatePodcastFeed?.({
          feedId,
          patchJson: JSON.stringify(patch),
        });
        if (!result?.feed) return fail('TRACK_NOT_FOUND', 'The show does not exist');
        emit({ type: 'feeds', feedId, reason: 'updated' });
        return ok(result.feed as PodcastFeed);
      } catch (error) {
        return fail('DATABASE_ERROR', error instanceof Error ? error.message : String(error));
      }
    },
    async removeFeed(feedId: string): Promise<Result<{ removed: boolean }>> {
      try {
        const result = await plugin()?.removePodcastFeed?.({ feedId });
        if (result?.removed) emit({ type: 'feeds', feedId, reason: 'removed' });
        return ok({ removed: Boolean(result?.removed) });
      } catch (error) {
        return fail('DATABASE_ERROR', error instanceof Error ? error.message : String(error));
      }
    },
    async refresh(feedId?: string): Promise<PodcastRefreshSummary> {
      const feeds = await listFeeds();
      const selected = feedId ? feeds.filter((feed) => feed.id === feedId) : feeds;
      let newEpisodes = 0;
      const errors: PodcastRefreshSummary['errors'] = [];
      for (const feed of selected) {
        const result = await refreshFeed(feed);
        newEpisodes += result.newEpisodes;
        if (result.error) errors.push({ feedId: feed.id, message: result.error });
      }
      return {
        feedId: feedId ?? null,
        refreshed: selected.length - errors.length,
        newEpisodes,
        failed: errors.length,
        errors,
      };
    },
    listEpisodes: (feedId: string) => listEpisodes(feedId),
    async getEpisode(episodeId: string): Promise<PodcastEpisode | null> {
      const result = await plugin()?.getPodcastEpisode?.({ episodeId });
      const episode = (result?.episode as PodcastEpisode | null | undefined) ?? null;
      if (episode) options.rememberTracks?.([episode]);
      return episode;
    },
    async setPlayed(episodeId: string, played: boolean): Promise<Result<PodcastEpisode>> {
      const result = await plugin()?.setPodcastEpisodePlayed?.({ episodeId, played });
      if (!result?.episode) return fail('TRACK_NOT_FOUND', 'The episode does not exist');
      emit({ type: 'episodes', feedId: result.episode.feedId, reason: 'played' });
      return ok(result.episode as PodcastEpisode);
    },
    async searchDirectory(query: string): Promise<Result<PodcastSearchResult[]>> {
      const encoded = encodeURIComponent(query.trim());
      if (!encoded) return fail('INVALID_ARGUMENT', 'Search query must be 1–200 characters');
      const allowLocalNetwork = await allowLocal();
      try {
        const fetchJson = async (url: string): Promise<unknown> => {
          const result = await plugin()?.fetchPodcastText?.({
            url,
            allowLocalNetwork: false,
            allowHtml: false,
          });
          if (!result?.body) throw new Error('The directory response was empty');
          return JSON.parse(String(result.body));
        };
        const [apple, fyyd] = await Promise.allSettled([
          fetchJson(
            `https://itunes.apple.com/search?term=${encoded}&media=podcast&entity=podcast&limit=40&country=US`,
          ).then((payload) =>
            parseAppleSearch(payload, { allowLocalNetwork: allowLocalNetwork }),
          ),
          fetchJson(`https://api.fyyd.de/0.2/search/podcast?term=${encoded}&count=30`).then(
            (payload) => parseFyydSearch(payload, { allowLocalNetwork }),
          ),
        ]);
        const results: PodcastSearchResult[] = [];
        if (apple.status === 'fulfilled') results.push(...apple.value);
        if (fyyd.status === 'fulfilled') results.push(...fyyd.value);
        const merged = dedupeDirectoryResults(results);
        if (merged.length === 0 && apple.status === 'rejected' && fyyd.status === 'rejected') {
          return fail('MEDIA_UNAVAILABLE', 'No podcast directory returned results');
        }
        return ok(merged);
      } catch (error) {
        return fail('MEDIA_UNAVAILABLE', error instanceof Error ? error.message : String(error));
      }
    },
    async cacheArtwork(url: string): Promise<Result<{ url: string | null }>> {
      try {
        const result = await plugin()?.cachePodcastArtwork?.({
          url,
          allowLocalNetwork: await allowLocal(),
        });
        return ok({
          url: typeof result?.url === 'string' && result.url.length > 0 ? result.url : null,
        });
      } catch {
        return ok({ url: null });
      }
    },
    async discover(): Promise<Result<PodcastDiscovery>> {
      const allowLocalNetwork = await allowLocal();
      try {
        const fetchJson = async (url: string): Promise<unknown> => {
          const result = await plugin()?.fetchPodcastText?.({
            url,
            allowLocalNetwork: false,
            allowHtml: false,
          });
          if (!result?.body) throw new Error('The directory response was empty');
          return JSON.parse(String(result.body));
        };
        const topPayload = await fetchJson(
          'https://itunes.apple.com/us/rss/toppodcasts/limit=100/json',
        );
        let lookupPayload: unknown = null;
        const chart = parseAppleTopCharts(topPayload);
        const ids = chart.slice(0, 50).map((entry) => entry.providerId);
        if (ids.length > 0) {
          try {
            lookupPayload = await fetchJson(
              `https://itunes.apple.com/lookup?id=${ids.join(',')}&entity=podcast&country=US`,
            );
          } catch {
            /* categories still work from the chart alone */
          }
        }
        const discovery = buildPodcastDiscovery(topPayload, lookupPayload, {
          allowLocalNetwork,
        });
        if (discovery.top.length === 0 && discovery.categories.length === 0) {
          return fail('MEDIA_UNAVAILABLE', 'The podcast directory returned no discovery data');
        }
        return ok(discovery);
      } catch (error) {
        return fail('MEDIA_UNAVAILABLE', 'The podcast directory is unavailable right now');
      }
    },
    async directoryStatus(): Promise<PodcastDirectoryStatus> {
      return { configured: true, provider: 'multiple', providers: ['apple', 'fyyd'] };
    },
    async setDirectoryCredentials(): Promise<Result<PodcastDirectoryStatus>> {
      return fail(
        'INVALID_ARGUMENT',
        'Directory credentials are not configured by users; Statocyst uses keyless Apple and Fyyd search',
      );
    },
    async clearDirectoryCredentials(): Promise<void> {
      /* no user-managed directory credentials */
    },
    async importOpml(): Promise<PodcastImportSummary> {
      const file = await pickFile('.opml,.xml,text/xml');
      if (!file) return EMPTY_IMPORT;
      const xml = await file.text();
      const parsed = parseOpml(xml, { allowLocalNetwork: await allowLocal() });
      const existing = new Set((await listFeeds()).map((feed) => feed.feedUrl));
      const added: PodcastFeed[] = [];
      let duplicates = 0;
      for (const entry of parsed.feeds) {
        if (existing.has(entry.feedUrl)) {
          duplicates += 1;
          continue;
        }
        try {
          const result = await plugin()?.savePodcastFeed?.({
            feedJson: JSON.stringify({
              feedUrl: entry.feedUrl,
              siteUrl: entry.siteUrl,
              title: entry.title ?? entry.feedUrl,
              feedType: 'rss',
              nextFetchAt: new Date().toISOString(),
              subscribed: true,
            }),
            episodesJson: '[]',
          });
          if (result?.feed) {
            existing.add(entry.feedUrl);
            added.push(result.feed as PodcastFeed);
          }
        } catch {
          /* individual feed failure is reported by the invalid count below */
        }
      }
      if (added.length > 0) void bridge.refresh();
      return {
        added: added.length,
        duplicates,
        invalid: parsed.invalid,
        scheduled: added.length,
        feeds: added,
      };
    },
    async exportOpml(): Promise<Result<{ path: string | null; bytes: number }>> {
      const xml = serializeOpml(
        (await listFeeds()).filter((feed) => feed.subscribed).map((feed) => ({
          title: feed.title,
          feedUrl: feed.feedUrl,
          siteUrl: feed.siteUrl,
        })),
        'Statocyst Podcasts',
      );
      const blob = new Blob([xml], { type: 'text/x-opml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'statocyst-podcasts.opml';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      return ok({ path: null, bytes: blob.size });
    },
    onChanged(listener: (event: PodcastChangeEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return bridge;
}

function nextFetch(intervalMinutes: number, failureCount = 0): string {
  const minutes = Math.max(15, Math.min(1_440, intervalMinutes || 60));
  const base = minutes * 60_000;
  const delay =
    failureCount > 0 ? Math.min(24 * 60 * 60_000, base * 2 ** Math.min(failureCount, 6)) : base;
  return new Date(Date.now() + delay).toISOString();
}

function discoverFeedUrls(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = attributeOf(tag, 'rel')?.toLowerCase() ?? '';
    const type = attributeOf(tag, 'type')?.toLowerCase() ?? '';
    if (!rel.split(/\s+/).includes('alternate')) continue;
    if (!type.includes('rss') && !type.includes('atom') && !type.endsWith('+xml')) continue;
    const href = attributeOf(tag, 'href');
    if (!href) continue;
    const resolved = resolveHttpUrl(href, baseUrl);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      found.push(resolved);
    }
  }
  return found;
}

function attributeOf(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}
