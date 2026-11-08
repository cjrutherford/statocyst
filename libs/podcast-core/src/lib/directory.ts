import type {
  PodcastDirectorySource,
  PodcastDiscovery,
  PodcastDiscoveryCategory,
  PodcastDiscoveryShelf,
  PodcastSearchResult,
} from '@statocyst/contracts';
import { decodeEntities } from './text';
import { normalizeFeedUrl } from './url';

/** Map an Apple iTunes Search API response into directory results. */
export function parseAppleSearch(
  payload: unknown,
  options: { allowLocalNetwork?: boolean } = {},
): PodcastSearchResult[] {
  const root = asObject(payload);
  const results = Array.isArray(root?.['results']) ? root['results'] : [];
  return results.flatMap((raw) => {
    const item = asObject(raw);
    if (!item) return [];
    const feedUrl = normalizeFeedUrl(stringValue(item['feedUrl']) ?? '', {
      allowLocalNetwork: options.allowLocalNetwork === true,
    });
    const title = decodeEntities(
      stringValue(item['collectionName']) ?? stringValue(item['trackName']) ?? '',
    );
    if (!feedUrl || !title) return [];
    return [
      {
        feedUrl,
        source: 'apple',
        providerId: stringValue(String(item['collectionId'] ?? item['trackId'] ?? '')),
        title,
        author: stringValue(item['artistName'])
          ? decodeEntities(stringValue(item['artistName']) as string)
          : null,
        descriptionText: null,
        artworkUrl:
          stringValue(item['artworkUrl600']) ??
          stringValue(item['artworkUrl100']) ??
          null,
        episodeCount:
          typeof item['trackCount'] === 'number' ? Math.trunc(item['trackCount']) : null,
        explicit:
          item['collectionExplicitness'] === 'explicit' ||
          item['trackExplicitness'] === 'explicit',
        podcastIndexId: null,
        categories: stringValue(item['primaryGenreName'])
          ? [stringValue(item['primaryGenreName']) as string]
          : [],
      },
    ];
  });
}

/** Map a Fyyd 0.2 podcast-search response into directory results. */
export function parseFyydSearch(
  payload: unknown,
  options: { allowLocalNetwork?: boolean } = {},
): PodcastSearchResult[] {
  const root = asObject(payload);
  const data = Array.isArray(root?.['data']) ? root['data'] : [];
  return data.flatMap((raw) => {
    const item = asObject(raw);
    if (!item) return [];
    const feedUrl = normalizeFeedUrl(
      stringValue(item['xmlURL']) ?? stringValue(item['url']) ?? '',
      { allowLocalNetwork: options.allowLocalNetwork === true },
    );
    const title = stringValue(item['title']) ? decodeEntities(stringValue(item['title']) as string) : null;
    if (!feedUrl || !title) return [];
    return [
      {
        feedUrl,
        source: 'fyyd',
        providerId: stringValue(String(item['id'] ?? '')),
        title,
        author: stringValue(item['author']) ? decodeEntities(stringValue(item['author']) as string) : null,
        descriptionText: stringValue(item['description'])
          ? decodeEntities(stringValue(item['description']) as string)
          : null,
        artworkUrl: stringValue(item['imgURL']) ?? stringValue(item['thumbImageURL']),
        episodeCount:
          typeof item['episodeCount'] === 'number'
            ? Math.trunc(item['episodeCount'])
            : null,
        explicit: item['explicit'] === true,
        podcastIndexId: null,
        categories: Array.isArray(item['categories'])
          ? item['categories'].filter((entry): entry is string => typeof entry === 'string')
          : [],
      },
    ];
  });
}

/** Map Apple Top Charts results (they need an iTunes lookup for feedUrl). */
export function parseAppleTopCharts(payload: unknown): Array<{
  providerId: string;
  title: string;
  author: string | null;
  artworkUrl: string | null;
  categories: string[];
}> {
  const root = asObject(payload);
  const feed = asObject(root?.['feed']);
  const results = Array.isArray(feed?.['results']) ? feed['results'] : [];
  if (results.length > 0) {
    return results.flatMap((raw) => {
      const item = asObject(raw);
      const id = item ? stringValue(String(item['id'] ?? '')) : null;
      const title = item ? stringValue(item['name']) : null;
      if (!item || !id || !title) return [];
      return [
        {
          providerId: id,
          title,
          author: stringValue(item['artistName']),
          artworkUrl: stringValue(item['artworkUrl100']),
          categories: Array.isArray(item['genres'])
            ? item['genres'].flatMap((genre) => {
                const value = asObject(genre);
                const name = value ? stringValue(value['name']) : null;
                return name ? [name] : [];
              })
            : [],
        },
      ];
    });
  }

  // Legacy iTunes top-podcasts JSON: feed.entry with label/attribute wrappers.
  const entries = feed?.['entry'];
  const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
  return list.flatMap((raw) => {
    const item = asObject(raw);
    if (!item) return [];
    const idNode = asObject(item['id']);
    const idAttrs = asObject(idNode?.['attributes']);
    const providerId =
      stringValue(idAttrs?.['im:id']) ??
      extractProviderId(stringValue(idNode?.['label']) ?? '');
    const titleNode = asObject(item['im:name']);
    const title = stringValue(titleNode?.['label'])
      ? decodeEntities(stringValue(titleNode?.['label']) as string)
      : null;
    if (!providerId || !title) return [];
    const artistNode = asObject(item['im:artist']);
    const images = Array.isArray(item['im:image']) ? item['im:image'] : [];
    const largestImage = images.length > 0 ? asObject(images[images.length - 1]) : null;
    const categoryNode = asObject(item['category']);
    const categoryAttrs = asObject(categoryNode?.['attributes']);
    const categoryName =
      stringValue(categoryAttrs?.['term']) ?? stringValue(categoryAttrs?.['label']);
    return [
      {
        providerId,
        title,
        author: stringValue(artistNode?.['label'])
          ? decodeEntities(stringValue(artistNode?.['label']) as string)
          : null,
        artworkUrl: stringValue(largestImage?.['label']),
        categories: categoryName ? [decodeEntities(categoryName)] : [],
      },
    ];
  });
}

function extractProviderId(value: string): string | null {
  const match = /\/id(\d+)/.exec(value) ?? /^(\d+)$/.exec(value);
  return match ? match[1] : null;
}

/**
 * Build the Discovery landing from an Apple top-chart payload and the matching
 * iTunes lookup payload. The chart has no feed URLs, so shows are only useful
 * once the lookup resolves them; categories still come from the chart itself.
 */
export function buildPodcastDiscovery(
  topPayload: unknown,
  lookupPayload: unknown,
  options: { allowLocalNetwork?: boolean; topLimit?: number } = {},
): PodcastDiscovery {
  const chart = parseAppleTopCharts(topPayload);
  const resolved = dedupeDirectoryResults(
    parseAppleSearch(lookupPayload, {
      allowLocalNetwork: options.allowLocalNetwork === true,
    }),
  );
  const byId = new Map<string, PodcastSearchResult>();
  for (const show of resolved) {
    if (show.providerId) byId.set(show.providerId, show);
  }

  const ordered: PodcastSearchResult[] = [];
  for (const entry of chart) {
    const show = byId.get(entry.providerId);
    if (!show) continue;
    ordered.push({
      ...show,
      title: show.title || entry.title,
      author: show.author ?? entry.author,
      artworkUrl: show.artworkUrl ?? entry.artworkUrl,
      categories: entry.categories.length > 0 ? entry.categories : show.categories,
    });
  }
  const uniqueShows = dedupeDirectoryResults(ordered);
  const topLimit = options.topLimit ?? 24;

  const counts = new Map<string, number>();
  for (const entry of chart) {
    for (const name of entry.categories) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const categories: PodcastDiscoveryCategory[] = [...counts.entries()]
    .map(([name, count]) => ({ id: slugifyCategory(name), name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const shelves: PodcastDiscoveryShelf[] = [];
  for (const category of categories) {
    const shows = uniqueShows
      .filter((show) => show.categories.includes(category.name))
      .slice(0, 12);
    if (shows.length >= 2) shelves.push({ category, shows });
  }

  return {
    top: uniqueShows.slice(0, topLimit),
    categories,
    shelves,
  };
}

function slugifyCategory(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'podcasts';
}

export function dedupeDirectoryResults(
  results: readonly PodcastSearchResult[],
): PodcastSearchResult[] {
  const byFeed = new Map<string, PodcastSearchResult>();
  for (const result of results) {
    const existing = byFeed.get(result.feedUrl);
    if (!existing) {
      byFeed.set(result.feedUrl, result);
      continue;
    }
    // Prefer the record with a description/artwork, then Apple as the canonical
    // catalog identity.
    const richer =
      (result.descriptionText?.length ?? 0) > (existing.descriptionText?.length ?? 0)
        ? result
        : existing;
    const preferred =
      existing.source === 'apple' ? existing : result.source === 'apple' ? result : richer;
    byFeed.set(result.feedUrl, {
      ...preferred,
      artworkUrl: preferred.artworkUrl ?? result.artworkUrl ?? existing.artworkUrl,
      descriptionText:
        preferred.descriptionText ?? result.descriptionText ?? existing.descriptionText,
      author: preferred.author ?? result.author ?? existing.author,
      categories:
        preferred.categories.length > 0 ? preferred.categories : result.categories,
    });
  }
  return [...byFeed.values()];
}

export function directorySourceLabel(source: PodcastDirectorySource): string {
  switch (source) {
    case 'apple':
      return 'Apple Podcasts';
    case 'fyyd':
      return 'Fyyd';
    case 'podcast-index':
      return 'Podcast Index';
    case 'gpodder':
      return 'gpodder.net';
    default:
      return 'Podcast directory';
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}
