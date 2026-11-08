import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  checkHttpUrl,
  isAlwaysBlockedAddress,
  isPrivateAddress,
} from '@statocyst/podcast-core';

export type PodcastFetchErrorCode =
  | 'INVALID_URL'
  | 'BLOCKED'
  | 'UNREACHABLE'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'TOO_MANY_REDIRECTS'
  | 'EMPTY_BODY';

export class PodcastFetchError extends Error {
  constructor(
    readonly code: PodcastFetchErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PodcastFetchError';
  }
}

export interface FetchedText {
  status: number;
  finalUrl: string;
  body: string | null;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
}

export interface FetchedBinary {
  status: number;
  finalUrl: string;
  body: Buffer;
  contentType: string | null;
}

export interface FeedFetcherOptions {
  allowLocalNetwork: () => boolean;
  userAgent: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
  lookupImpl?: typeof lookup;
}

export interface FetchTextOptions {
  etag?: string | null;
  lastModified?: string | null;
  accept?: string;
  allowHtml?: boolean;
  /** Permit application/json responses (directory search). */
  allowJson?: boolean;
  maxBytes?: number;
}

const XML_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/xml',
  'text/xml',
  'application/xhtml+xml',
  'text/javascript',
  'application/javascript',
  'text/plain',
];

const VIDEO_OR_AUDIO = ['audio/', 'video/'];

function contentTypeBase(value: string | null): string {
  return (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

export class FeedFetcher {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;
  private readonly fetchImpl: typeof fetch;
  private readonly lookupImpl: typeof lookup;

  constructor(private readonly options: FeedFetcherOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxBytes = options.maxBytes ?? 15 * 1024 * 1024;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.lookupImpl = options.lookupImpl ?? lookup;
  }

  async fetchText(url: string, options: FetchTextOptions = {}): Promise<FetchedText> {
    return this.request(url, options, false, options.maxBytes ?? this.maxBytes) as Promise<FetchedText>;
  }

  async fetchBinary(
    url: string,
    accept: string,
    maxBytes = 8 * 1024 * 1024,
  ): Promise<FetchedBinary> {
    return this.request(url, { accept }, true, maxBytes) as Promise<FetchedBinary>;
  }

  private async request(
    url: string,
    options: FetchTextOptions,
    binary: boolean,
    maxBytes: number,
  ): Promise<FetchedText | FetchedBinary> {
    let current = url;
    for (let redirect = 0; redirect <= this.maxRedirects; redirect += 1) {
      await this.assertSafe(current);
      const headers: Record<string, string> = {
        'User-Agent': this.options.userAgent,
        Accept:
          options.accept ??
          (binary
            ? 'image/*'
            : `${XML_TYPES.join(', ')}, text/html;q=0.8, application/octet-stream;q=0.1`),
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      };
      if (!binary && options.etag) headers['If-None-Match'] = options.etag;
      if (!binary && options.lastModified) headers['If-Modified-Since'] = options.lastModified;

      let response: Response;
      try {
        response = await this.fetchImpl(current, {
          method: 'GET',
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
          throw new PodcastFetchError('TIMEOUT', 'The feed request timed out');
        }
        throw new PodcastFetchError('UNREACHABLE', 'The feed host did not respond');
      }

      if (response.status === 304) {
        return {
          status: 304,
          finalUrl: current,
          body: null,
          contentType: response.headers.get('content-type'),
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
        };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new PodcastFetchError('HTTP_ERROR', `The feed returned HTTP ${response.status}`, response.status);
        }
        const next = new URL(location, current);
        current = next.toString();
        continue;
      }

      if (!response.ok) {
        throw new PodcastFetchError('HTTP_ERROR', `The feed returned HTTP ${response.status}`, response.status);
      }

      const type = contentTypeBase(response.headers.get('content-type'));
      const allowed = binary
        ? type.startsWith('image/')
        : XML_TYPES.includes(type) ||
          type === 'text/html' ||
          (options.allowJson === true && type === 'application/json') ||
          type === 'application/octet-stream' ||
          type === '';
      if (!allowed) {
        throw new PodcastFetchError(
          'UNSUPPORTED_CONTENT_TYPE',
          `Unsupported feed content type: ${type || 'missing'}`,
        );
      }
      if (!binary && type === 'text/html' && !options.allowHtml) {
        throw new PodcastFetchError('UNSUPPORTED_CONTENT_TYPE', 'The feed URL returned HTML');
      }

      const lengthHeader = response.headers.get('content-length');
      if (lengthHeader && Number(lengthHeader) > maxBytes) {
        throw new PodcastFetchError('TOO_LARGE', `The response is larger than ${maxBytes} bytes`);
      }

      const body = await readLimited(response, maxBytes);
      if (binary) {
        if (VIDEO_OR_AUDIO.some((prefix) => type.startsWith(prefix))) {
          throw new PodcastFetchError('UNSUPPORTED_CONTENT_TYPE', 'Expected an image response');
        }
        return {
          status: response.status,
          finalUrl: current,
          body,
          contentType: type || null,
        };
      }
      if (body.byteLength === 0) {
        throw new PodcastFetchError('EMPTY_BODY', 'The feed response is empty');
      }
      return {
        status: response.status,
        finalUrl: current,
        body: new TextDecoder('utf-8').decode(body),
        contentType: type || null,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      };
    }
    throw new PodcastFetchError('TOO_MANY_REDIRECTS', 'The feed redirected too many times');
  }

  private async assertSafe(url: string): Promise<void> {
    const allowLocal = this.options.allowLocalNetwork();
    const checked = checkHttpUrl(url, { allowLocalNetwork: allowLocal });
    if (!checked.ok) {
      throw new PodcastFetchError('BLOCKED', checked.message);
    }
    const host = checked.url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) {
      if (isAlwaysBlockedAddress(host) || (!allowLocal && isPrivateAddress(host))) {
        throw new PodcastFetchError('BLOCKED', 'Private or link-local feed addresses are not allowed');
      }
      return;
    }
    let addresses: Array<{ address: string }>;
    try {
      addresses = await this.lookupImpl(host, { all: true, verbatim: true });
    } catch {
      throw new PodcastFetchError('UNREACHABLE', 'The feed host could not be resolved');
    }
    if (addresses.length === 0) {
      throw new PodcastFetchError('UNREACHABLE', 'The feed host did not resolve');
    }
    for (const entry of addresses) {
      if (isAlwaysBlockedAddress(entry.address) || (!allowLocal && isPrivateAddress(entry.address))) {
        throw new PodcastFetchError(
          'BLOCKED',
          'The feed host resolves to a private or link-local address',
        );
      }
    }
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new PodcastFetchError('TOO_LARGE', `The response is larger than ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    }
  } catch (error) {
    if (error instanceof PodcastFetchError) throw error;
    throw new PodcastFetchError('UNREACHABLE', 'The response stream failed');
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}
