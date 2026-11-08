import { createHash } from 'node:crypto';
import type { PodcastSearchResult } from '@statocyst/contracts';

export interface PodcastIndexCredentials {
  apiKey: string;
  secret: string;
}

export class PodcastDirectoryError extends Error {
  constructor(
    readonly code: 'UNAUTHORIZED' | 'UNREACHABLE' | 'INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'PodcastDirectoryError';
  }
}

export interface PodcastIndexClientOptions {
  userAgent: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/** Podcast Index API adapter. The key/secret are supplied by the host's secure store. */
export class PodcastIndexClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: PodcastIndexClientOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://api.podcastindex.org/api/1.0').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async search(query: string, credentials: PodcastIndexCredentials): Promise<PodcastSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      throw new PodcastDirectoryError('INVALID_RESPONSE', 'Search query must be 1–200 characters');
    }
    const date = Math.floor(this.now().getTime() / 1000).toString();
    const authorization = createHash('sha1')
      .update(`${credentials.apiKey}${credentials.secret}${date}`)
      .digest('hex');
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/search/byterm?q=${encodeURIComponent(trimmed)}`,
        {
          headers: {
            'User-Agent': this.options.userAgent,
            'X-Auth-Key': credentials.apiKey,
            'X-Auth-Date': date,
            Authorization: authorization,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      throw new PodcastDirectoryError('UNREACHABLE', 'Podcast Index did not respond');
    }
    if (response.status === 401 || response.status === 403) {
      throw new PodcastDirectoryError('UNAUTHORIZED', 'Podcast Index rejected the credentials');
    }
    if (!response.ok) {
      throw new PodcastDirectoryError(
        'UNREACHABLE',
        `Podcast Index returned HTTP ${response.status}`,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PodcastDirectoryError('INVALID_RESPONSE', 'Podcast Index returned invalid JSON');
    }
    const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    if (root['status'] !== 'true' && root['status'] !== true) {
      throw new PodcastDirectoryError(
        'INVALID_RESPONSE',
        typeof root['description'] === 'string'
          ? root['description']
          : 'Podcast Index returned an error',
      );
    }
    const feeds = Array.isArray(root['feeds']) ? root['feeds'] : [];
    return feeds.flatMap((feed) => {
      if (!feed || typeof feed !== 'object') return [];
      const item = feed as Record<string, unknown>;
      const feedUrl = stringValue(item['url']) ?? stringValue(item['feedUrl']);
      const title = stringValue(item['title']);
      if (!feedUrl || !title) return [];
      return [
        {
          feedUrl,
          source: 'podcast-index' as const,
          providerId:
            typeof item['id'] === 'number' ? String(item['id']) : stringValue(String(item['id'] ?? '')),
          title,
          author: stringValue(item['author']) ?? stringValue(item['ownerName']),
          descriptionText: stringValue(item['description']),
          artworkUrl: stringValue(item['artwork']) ?? stringValue(item['image']),
          episodeCount:
            typeof item['episodeCount'] === 'number' ? item['episodeCount'] : null,
          explicit: item['explicit'] === true || item['explicit'] === 1,
          podcastIndexId:
            typeof item['id'] === 'number'
              ? item['id']
              : Number.isFinite(Number(item['id']))
                ? Number(item['id'])
                : null,
          categories: categoryValues(item['categories']),
        },
      ];
    });
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function categoryValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string').slice(0, 50);
  }
  if (value && typeof value === 'object') {
    return Object.values(value)
      .filter((entry): entry is string => typeof entry === 'string')
      .slice(0, 50);
  }
  return [];
}
