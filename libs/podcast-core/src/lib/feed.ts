import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { MediaForm, PodcastEnclosure } from '@statocyst/contracts';
import { PodcastParseError } from './errors';
import { decodeEntities, extractLinks, stripHtml } from './text';
import type { ParsedPodcastEpisode, ParsedPodcastFeed, ParsePodcastFeedOptions } from './types';
import { checkHttpUrl, resolveHttpUrl } from './url';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: false,
  htmlEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  allowBooleanAttributes: true,
  stopNodes: ['*.description', '*.summary', '*.content', '*.content:encoded'],
});

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_EPISODES = 2_000;
const MAX_ALTERNATES = 8;

/** Conservative extension hints. MIME and `medium` win over these. */
const AUDIO_EXTENSIONS = new Set([
  'aac',
  'aif',
  'aiff',
  'flac',
  'm4a',
  'm4b',
  'mp3',
  'oga',
  'ogg',
  'opus',
  'wav',
  'wma',
]);
const VIDEO_EXTENSIONS = new Set([
  'avi',
  'm2ts',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
  'ogv',
  'ts',
  'webm',
]);

interface RawEnclosure {
  url: string;
  type: string | null;
  medium: string | null;
  lengthBytes: number | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
}

interface EpisodeMedia {
  enclosureUrl: string;
  enclosureType: string | null;
  enclosureLengthBytes: number | null;
  mediaForm: MediaForm;
  alternates: PodcastEnclosure[];
  videoWidth: number | null;
  videoHeight: number | null;
}

export async function parsePodcastFeed(
  xml: string,
  options: ParsePodcastFeedOptions,
): Promise<ParsedPodcastFeed> {
  if (typeof xml !== 'string' || xml.trim().length === 0) {
    throw new PodcastParseError('EMPTY', 'The feed response is empty');
  }
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (new TextEncoder().encode(xml).byteLength > maxBytes) {
    throw new PodcastParseError('TOO_LARGE', `The feed is larger than ${maxBytes} bytes`);
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new PodcastParseError('DOCTYPE', 'DTD and entity declarations are not accepted');
  }

  if (XMLValidator.validate(xml) !== true) {
    throw new PodcastParseError('MALFORMED_XML', 'The feed is not valid XML');
  }

  let document: Record<string, unknown>;
  try {
    document = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new PodcastParseError('MALFORMED_XML', 'The feed is not valid XML');
  }

  const baseUrl = options.resolvedUrl ?? options.feedUrl;
  const checkedBase = checkHttpUrl(baseUrl, {
    allowLocalNetwork: options.allowLocalNetwork,
  });
  if (!checkedBase.ok) {
    throw new PodcastParseError('NOT_A_FEED', 'The feed URL is not a valid HTTP(S) URL');
  }

  const rss = asObject(document['rss']);
  if (rss && asObject(rss['channel'])) {
    return parseRss(rss['channel'], options, baseUrl);
  }
  const atom = asObject(document['feed']);
  if (atom) {
    return parseAtom(atom, options, baseUrl);
  }
  throw new PodcastParseError(
    'NOT_A_FEED',
    'The document is not an RSS or Atom podcast feed',
  );
}

async function parseRss(
  channelValue: unknown,
  options: ParsePodcastFeedOptions,
  baseUrl: string,
): Promise<ParsedPodcastFeed> {
  const channel = asObject(channelValue) ?? {};
  const feedExplicit = parseExplicit(textOf(channel['itunes:explicit'])) ?? false;
  const feedImage =
    attribute(channel['itunes:image'], 'href') ??
    textOf(asObject(channel['image'])?.['url']) ??
    null;
  const feedDescriptionRaw =
    textOf(channel['itunes:summary']) || textOf(channel['description']) || '';
  const episodes = await buildEpisodes(
    asArray(channel['item']),
    parseRssItem,
    { ...options, feedExplicit },
    baseUrl,
  );
  return {
    feedUrl: options.feedUrl,
    resolvedUrl: baseUrl,
    feedType: 'rss',
    title: textOf(channel['title']) || 'Untitled podcast',
    author:
      textOf(channel['itunes:author']) ||
      textOf(channel['managingEditor']) ||
      textOf(channel['webMaster']) ||
      null,
    descriptionText: stripHtml(feedDescriptionRaw) || null,
    siteUrl: resolveOptionalHttpUrl(textOf(channel['link']), baseUrl),
    imageUrl: resolveOptionalHttpUrl(feedImage, baseUrl),
    language: textOf(channel['language']) || null,
    explicit: feedExplicit,
    categories: collectCategories(channel['itunes:category']),
    podcastIndexId: null,
    ...episodes,
  };
}

async function parseAtom(
  feedValue: unknown,
  options: ParsePodcastFeedOptions,
  baseUrl: string,
): Promise<ParsedPodcastFeed> {
  const feed = asObject(feedValue) ?? {};
  const feedExplicit = parseExplicit(textOf(feed['itunes:explicit'])) ?? false;
  const links = asArray(feed['link']);
  const alternate = links.find(
    (link) => attribute(link, 'rel') === 'alternate' || attribute(link, 'rel') === undefined,
  );
  const feedImage =
    textOf(feed['logo']) ||
    textOf(feed['icon']) ||
    attribute(feed['itunes:image'], 'href') ||
    '';
  const author = asObject(feed['author']);
  return {
    feedUrl: options.feedUrl,
    resolvedUrl: baseUrl,
    feedType: 'atom',
    title: textOf(feed['title']) || 'Untitled podcast',
    author: textOf(author?.['name']) || textOf(feed['itunes:author']) || null,
    descriptionText: stripHtml(textOf(feed['subtitle']) || textOf(feed['summary']) || '') || null,
    siteUrl: resolveOptionalHttpUrl(attribute(alternate, 'href') ?? textOf(feed['link']), baseUrl),
    imageUrl: resolveOptionalHttpUrl(feedImage, baseUrl),
    language: attribute(feed, 'xml:lang') ?? attribute(feed, 'lang') ?? null,
    explicit: feedExplicit,
    categories: collectCategories(feed['category']),
    podcastIndexId: null,
    ...(await buildEpisodes(
      asArray(feed['entry']),
      parseAtomEntry,
      { ...options, feedExplicit },
      baseUrl,
    )),
  };
}

interface EpisodeContext extends ParsePodcastFeedOptions {
  feedExplicit: boolean;
}

type ParsedEpisodeBase = Omit<ParsedPodcastEpisode, 'pathKey'>;

async function buildEpisodes(
  items: readonly unknown[],
  parse: (item: Record<string, unknown>, context: EpisodeContext, baseUrl: string) => ParsedEpisodeBase | null,
  context: EpisodeContext,
  baseUrl: string,
): Promise<{ episodes: ParsedPodcastEpisode[]; truncated: number; dropped: number; warnings: string[] }> {
  const maxEpisodes = context.maxEpisodes ?? DEFAULT_MAX_EPISODES;
  const episodes: ParsedPodcastEpisode[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of items) {
    const item = asObject(raw);
    if (!item) {
      dropped += 1;
      continue;
    }
    const base = parse(item, context, baseUrl);
    if (!base) {
      dropped += 1;
      continue;
    }
    if (seen.has(base.guid)) {
      dropped += 1;
      continue;
    }
    seen.add(base.guid);
    episodes.push({ ...base, pathKey: await podcastPathKey(baseUrl, base.guid) });
  }
  const indexed = episodes.map((episode, index) => ({ episode, index }));
  indexed.sort((a, b) => {
    const byDate = (b.episode.publishedAt ?? '').localeCompare(a.episode.publishedAt ?? '');
    return byDate !== 0 ? byDate : a.index - b.index;
  });
  const kept = indexed.slice(0, maxEpisodes).map((entry) => entry.episode);
  const warnings: string[] = [];
  if (dropped > 0) warnings.push(`${dropped} item(s) skipped: no valid enclosure or duplicate GUID`);
  const truncated = episodes.length - kept.length;
  if (truncated > 0) warnings.push(`${truncated} episode(s) beyond the ${maxEpisodes} cap were not stored`);
  return { episodes: kept, truncated, dropped, warnings };
}

function parseRssItem(
  item: Record<string, unknown>,
  context: EpisodeContext,
  baseUrl: string,
): ParsedEpisodeBase | null {
  const rawEnclosures: RawEnclosure[] = [];
  for (const value of asArray(item['enclosure'])) {
    const raw = attribute(value, 'url') ?? textOf(value);
    if (raw) {
      rawEnclosures.push(
        rawEnclosure(raw, {
          type: attribute(value, 'type'),
          lengthBytes: parseInteger(attribute(value, 'length')),
        }),
      );
    }
  }
  for (const value of mediaContentValues(item)) {
    const content = mediaContentRaw(value);
    if (content) rawEnclosures.push(content);
  }
  for (const value of asArray(item['podcast:alternateEnclosure'])) {
    rawEnclosures.push(...alternateEnclosureRaws(value));
  }
  const media = selectEpisodeMedia(rawEnclosures, baseUrl, context.allowLocalNetwork);
  if (!media) return null;

  const guid = (textOf(item['guid']) || media.enclosureUrl).trim();
  const descriptionRaw =
    textOf(item['content:encoded']) ||
    textOf(item['description']) ||
    textOf(item['itunes:summary']) ||
    '';
  const title = textOf(item['title']) || 'Untitled episode';
  const publishedAt = parseDate(
    textOf(item['pubDate']) || textOf(item['published']) || textOf(item['dc:date']),
  );
  const image =
    attribute(item['itunes:image'], 'href') ?? textOf(asObject(item['image'])?.['url']) ?? null;
  const posterUrl =
    resolveSafeOptionalHttpUrl(image, baseUrl, context.allowLocalNetwork) ??
    resolveSafeOptionalHttpUrl(firstMediaThumbnail(item), baseUrl, context.allowLocalNetwork) ??
    null;
  const transcript = asArray(item['podcast:transcript']).find((value) => attribute(value, 'url'));
  return {
    guid,
    title,
    descriptionText: stripHtml(descriptionRaw) || null,
    links: extractLinks(descriptionRaw, baseUrl),
    link: resolveOptionalHttpUrl(textOf(item['link']), baseUrl),
    ...media,
    posterUrl,
    durationMs: parseDuration(textOf(item['itunes:duration'])),
    publishedAt,
    seasonNo: parseInteger(textOf(item['itunes:season'])),
    episodeNo: parseInteger(textOf(item['itunes:episode'])),
    episodeType: textOf(item['itunes:episodeType']) || null,
    imageUrl: resolveOptionalHttpUrl(image, baseUrl),
    explicit: parseExplicit(textOf(item['itunes:explicit'])) ?? context.feedExplicit,
    chaptersUrl: resolveOptionalHttpUrl(attribute(item['podcast:chapters'], 'url'), baseUrl),
    transcriptUrl: resolveOptionalHttpUrl(attribute(transcript, 'url'), baseUrl),
    transcriptType: attribute(transcript, 'type') ?? null,
  };
}

function parseAtomEntry(
  entry: Record<string, unknown>,
  context: EpisodeContext,
  baseUrl: string,
): ParsedEpisodeBase | null {
  const links = asArray(entry['link']);
  const rawEnclosures: RawEnclosure[] = [];
  for (const link of links) {
    const type = attribute(link, 'type');
    const rel = (attribute(link, 'rel') ?? '').toLowerCase();
    const mime = (type ?? '').trim().toLowerCase();
    if (rel !== 'enclosure' && !mime.startsWith('audio/') && !mime.startsWith('video/')) {
      continue;
    }
    const raw = attribute(link, 'href') ?? attribute(link, 'url');
    if (raw) {
      rawEnclosures.push(
        rawEnclosure(raw, {
          type,
          lengthBytes: parseInteger(attribute(link, 'length')),
        }),
      );
    }
  }
  for (const value of mediaContentValues(entry)) {
    const content = mediaContentRaw(value);
    if (content) rawEnclosures.push(content);
  }
  for (const value of asArray(entry['podcast:alternateEnclosure'])) {
    rawEnclosures.push(...alternateEnclosureRaws(value));
  }
  const media = selectEpisodeMedia(rawEnclosures, baseUrl, context.allowLocalNetwork);
  if (!media) return null;

  const guid = (textOf(entry['id']) || media.enclosureUrl).trim();
  const descriptionRaw =
    textOf(entry['content']) || textOf(entry['summary']) || textOf(entry['itunes:summary']) || '';
  const alternate = links.find(
    (link) => attribute(link, 'rel') === 'alternate' || attribute(link, 'rel') === undefined,
  );
  const publishedAt = parseDate(textOf(entry['published']) || textOf(entry['updated']));
  const episodeImage = attribute(entry['itunes:image'], 'href') ?? null;
  const thumbnail = firstMediaThumbnail(entry);
  const image = episodeImage ?? thumbnail;
  const posterUrl =
    resolveSafeOptionalHttpUrl(episodeImage, baseUrl, context.allowLocalNetwork) ??
    resolveSafeOptionalHttpUrl(thumbnail, baseUrl, context.allowLocalNetwork) ??
    null;
  const transcript = asArray(entry['podcast:transcript']).find((value) => attribute(value, 'url'));
  return {
    guid,
    title: textOf(entry['title']) || 'Untitled episode',
    descriptionText: stripHtml(descriptionRaw) || null,
    links: extractLinks(descriptionRaw, baseUrl),
    link: resolveOptionalHttpUrl(attribute(alternate, 'href'), baseUrl),
    ...media,
    posterUrl,
    durationMs: parseDuration(textOf(entry['itunes:duration'])),
    publishedAt,
    seasonNo: parseInteger(textOf(entry['itunes:season'])),
    episodeNo: parseInteger(textOf(entry['itunes:episode'])),
    episodeType: textOf(entry['itunes:episodeType']) || null,
    imageUrl: resolveOptionalHttpUrl(image, baseUrl),
    explicit: parseExplicit(textOf(entry['itunes:explicit'])) ?? context.feedExplicit,
    chaptersUrl: resolveOptionalHttpUrl(attribute(entry['podcast:chapters'], 'url'), baseUrl),
    transcriptUrl: resolveOptionalHttpUrl(attribute(transcript, 'url'), baseUrl),
    transcriptType: attribute(transcript, 'type') ?? null,
  };
}

function rawEnclosure(
  url: string,
  values: Partial<Omit<RawEnclosure, 'url'>>,
): RawEnclosure {
  return {
    url,
    type: values.type ?? null,
    medium: values.medium ?? null,
    lengthBytes: values.lengthBytes ?? null,
    width: values.width ?? null,
    height: values.height ?? null,
    bitrate: values.bitrate ?? null,
  };
}

function mediaContentValues(item: Record<string, unknown>): unknown[] {
  const values = [...asArray(item['media:content'])];
  for (const group of asArray(item['media:group'])) {
    const object = asObject(group);
    if (object) values.push(...asArray(object['media:content']));
  }
  return values;
}

function mediaContentRaw(value: unknown): RawEnclosure | null {
  const url = attribute(value, 'url') ?? attribute(value, 'href');
  if (!url) return null;
  const medium = attribute(value, 'medium');
  return rawEnclosure(url, {
    type: attribute(value, 'type'),
    medium,
    lengthBytes: parseInteger(attribute(value, 'fileSize') ?? attribute(value, 'length')),
    width: parseInteger(attribute(value, 'width')),
    height: parseInteger(attribute(value, 'height')),
    bitrate: parseInteger(attribute(value, 'bitrate')),
  });
}

/**
 * Podcast 2.0 `<podcast:alternateEnclosure>` carries one or more
 * `<podcast:source uri="…">` children. Metadata on the parent applies to each
 * source; a source-level `contentType` overrides the parent `type`.
 */
function alternateEnclosureRaws(value: unknown): RawEnclosure[] {
  const object = asObject(value);
  if (!object) return [];
  const parentType = attribute(value, 'type');
  const medium = attribute(value, 'medium');
  const lengthBytes = parseInteger(attribute(value, 'length'));
  const bitrate = parseInteger(attribute(value, 'bitrate'));
  const width = parseInteger(attribute(value, 'width'));
  const height = parseInteger(attribute(value, 'height'));
  const raws: RawEnclosure[] = [];
  for (const source of asArray(object['podcast:source'])) {
    const url =
      attribute(source, 'uri') ??
      attribute(source, 'url') ??
      attribute(source, 'href');
    if (!url) continue;
    raws.push(
      rawEnclosure(url, {
        type: attribute(source, 'contentType') ?? parentType,
        medium,
        lengthBytes,
        width,
        height,
        bitrate,
      }),
    );
  }
  const directUrl = attribute(value, 'url') ?? attribute(value, 'href');
  if (directUrl) {
    raws.push(
      rawEnclosure(directUrl, { type: parentType, medium, lengthBytes, width, height, bitrate }),
    );
  }
  return raws;
}

function firstMediaThumbnail(item: Record<string, unknown>): string | null {
  const values = [...asArray(item['media:thumbnail'])];
  for (const group of asArray(item['media:group'])) {
    const object = asObject(group);
    if (object) values.push(...asArray(object['media:thumbnail']));
  }
  for (const value of values) {
    const url = attribute(value, 'url') ?? attribute(value, 'href') ?? textOf(value);
    if (url) return url;
  }
  return null;
}

/**
 * Validate and deduplicate every advertised enclosure, then choose one primary.
 * Audio is primary whenever an audio form exists; the feed-level preference is
 * applied by ingestion, not here. Video metadata is kept even when audio wins.
 */
function selectEpisodeMedia(
  values: readonly RawEnclosure[],
  baseUrl: string,
  allowLocalNetwork: boolean | undefined,
): EpisodeMedia | null {
  const ordered: RawEnclosure[] = [];
  const byUrl = new Map<string, RawEnclosure>();
  for (const value of values) {
    const url = validateEnclosureUrl(value.url, baseUrl, allowLocalNetwork);
    if (!url) continue;
    const existing = byUrl.get(url);
    if (!existing) {
      const copy = { ...value, url };
      byUrl.set(url, copy);
      ordered.push(copy);
      continue;
    }
    // The same URL may be advertised by several elements; merge the richest
    // metadata without letting a later element overwrite an earlier one.
    existing.type ??= value.type;
    existing.medium ??= value.medium;
    existing.lengthBytes ??= value.lengthBytes;
    existing.width ??= value.width;
    existing.height ??= value.height;
    existing.bitrate ??= value.bitrate;
  }
  if (ordered.length === 0) return null;

  const classified = ordered.map((value) => ({
    ...value,
    form: classifyMediaForm(value),
  }));
  const primary = classified.find((value) => value.form === 'audio') ?? classified[0];
  const alternates: PodcastEnclosure[] = [];
  const retained = new Set<string>([primary.url]);
  for (const value of classified) {
    if (retained.has(value.url)) continue;
    if (alternates.length >= MAX_ALTERNATES) break;
    retained.add(value.url);
    alternates.push(toPodcastEnclosure(value));
  }
  // Do not let a long audio-only alternates list hide the video form.
  if (alternates.length === MAX_ALTERNATES && primary.form === 'audio') {
    const video = classified.find((value) => value.form === 'video' && !retained.has(value.url));
    if (video) {
      retained.delete(alternates[alternates.length - 1].url);
      alternates[alternates.length - 1] = toPodcastEnclosure(video);
    }
  }

  const video =
    classified.find(
      (value) => value.form === 'video' && value.width !== null && value.height !== null,
    ) ??
    classified.find(
      (value) => value.form === 'video' && (value.width !== null || value.height !== null),
    ) ??
    classified.find((value) => value.form === 'video');
  return {
    enclosureUrl: primary.url,
    enclosureType: primary.type,
    enclosureLengthBytes: primary.lengthBytes,
    mediaForm: primary.form,
    alternates,
    videoWidth: video?.width ?? null,
    videoHeight: video?.height ?? null,
  };
}

function validateEnclosureUrl(
  raw: string,
  baseUrl: string,
  allowLocalNetwork: boolean | undefined,
): string | null {
  const resolved = resolveHttpUrl(raw, baseUrl);
  if (!resolved) return null;
  const safety = checkHttpUrl(resolved, { allowLocalNetwork });
  return safety.ok ? resolved : null;
}

function classifyMediaForm(value: RawEnclosure): MediaForm {
  const mime = (value.type ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  const medium = (value.medium ?? '').trim().toLowerCase();
  if (medium === 'audio' || medium === 'video') return medium;
  const extension = urlExtension(value.url);
  if (extension && VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (extension && AUDIO_EXTENSIONS.has(extension)) return 'audio';
  // Unknown or application/octet-stream: never assume video.
  return 'audio';
}

function urlExtension(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const match = /\.([a-z0-9]+)$/i.exec(path);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function toPodcastEnclosure(value: RawEnclosure & { form: MediaForm }): PodcastEnclosure {
  return {
    url: value.url,
    type: value.type,
    form: value.form,
    lengthBytes: value.lengthBytes,
    width: value.width,
    height: value.height,
    bitrate: value.bitrate,
  };
}

function resolveSafeOptionalHttpUrl(
  value: string | null | undefined,
  baseUrl: string,
  allowLocalNetwork: boolean | undefined,
): string | null {
  const resolved = resolveOptionalHttpUrl(value, baseUrl);
  if (!resolved) return null;
  return checkHttpUrl(resolved, { allowLocalNetwork }).ok ? resolved : null;
}

/** Must match the persistence layer's stable media identity. */
export async function podcastPathKey(feedUrl: string, guid: string): Promise<string> {
  const data = new TextEncoder().encode(`${feedUrl}\u0000${guid}`);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new PodcastParseError('UNSUPPORTED_XML', 'SHA-256 is unavailable in this runtime');
  }
  const digest = await subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `podcast:${hex}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string {
  let raw = '';
  if (typeof value === 'string') raw = value.trim();
  else if (typeof value === 'number' || typeof value === 'boolean') raw = String(value);
  else {
    const object = asObject(value);
    if (!object) return '';
    const text = object['#text'];
    raw = typeof text === 'string' || typeof text === 'number' ? String(text).trim() : '';
  }
  return raw ? decodeEntities(raw) : raw;
}

function resolveOptionalHttpUrl(value: string | null | undefined, baseUrl: string): string | null {
  if (!value || value.trim().length === 0) return null;
  return resolveHttpUrl(value.trim(), baseUrl);
}

function attribute(value: unknown, name: string): string | undefined {
  const object = asObject(value);
  const raw = object?.[`@_${name}`];
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw) : undefined;
}

function parseInteger(value: string | undefined | null): number | null {
  if (value === undefined || value === null || value.trim().length === 0) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseExplicit(value: string | undefined | null): boolean | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'explicit', '1'].includes(normalized)) return true;
  if (['false', 'no', 'clean', '0'].includes(normalized)) return false;
  return null;
}

function parseDate(value: string | undefined | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseDuration(value: string | undefined | null): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.round(Number(trimmed) * 1000));
  }
  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) {
    return 0;
  }
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return Math.max(0, Math.round(seconds * 1000));
}

function collectCategories(value: unknown): string[] {
  const categories: string[] = [];
  const walk = (raw: unknown): void => {
    for (const item of asArray(raw)) {
      const object = asObject(item);
      const text = attribute(item, 'text') ?? attribute(item, 'term') ?? textOf(item);
      if (text) categories.push(text);
      walk(object?.['itunes:category']);
    }
  };
  walk(value);
  return [...new Set(categories)].slice(0, 50);
}
