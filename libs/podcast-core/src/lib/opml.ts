import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { PodcastParseError } from './errors';
import type { OpmlFeed, ParseOpmlOptions, ParsedOpml } from './types';
import { normalizeFeedUrl } from './url';

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
});

const DEFAULT_MAX_FEEDS = 5_000;

export function parseOpml(xml: string, options: ParseOpmlOptions = {}): ParsedOpml {
  if (typeof xml !== 'string' || xml.trim().length === 0) {
    throw new PodcastParseError('EMPTY', 'The OPML document is empty');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new PodcastParseError('DOCTYPE', 'DTD and entity declarations are not accepted');
  }
  if (XMLValidator.validate(xml) !== true) {
    throw new PodcastParseError('MALFORMED_XML', 'The OPML document is not valid XML');
  }

  let document: Record<string, unknown>;
  try {
    document = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new PodcastParseError('MALFORMED_XML', 'The OPML document is not valid XML');
  }
  const opml = asObject(document['opml']);
  const body = asObject(opml?.['body']);
  if (!opml || !body) {
    throw new PodcastParseError('NOT_A_FEED', 'The document is not an OPML file');
  }

  const maxFeeds = options.maxFeeds ?? DEFAULT_MAX_FEEDS;
  const feeds: OpmlFeed[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  let truncated = false;

  const walk = (outline: unknown): void => {
    for (const value of asArray(outline)) {
      if (truncated) return;
      const object = asObject(value);
      if (!object) continue;
      const rawFeedUrl =
        attribute(object, 'xmlUrl') ??
        attribute(object, 'xmlurl') ??
        attribute(object, 'feedUrl') ??
        attribute(object, 'feedurl');
      if (rawFeedUrl) {
        if (feeds.length >= maxFeeds) {
          truncated = true;
          return;
        }
        const feedUrl = normalizeFeedUrl(rawFeedUrl, {
          allowLocalNetwork: options.allowLocalNetwork,
        });
        if (!feedUrl) {
          invalid += 1;
        } else if (seen.has(feedUrl)) {
          duplicates += 1;
        } else {
          seen.add(feedUrl);
          feeds.push({
            title:
              attribute(object, 'text') ??
              attribute(object, 'title') ??
              textOf(object['#text']) ??
              null,
            feedUrl,
            siteUrl:
              attribute(object, 'htmlUrl') ?? attribute(object, 'htmlurl') ?? null,
          });
        }
      }
      walk(object['outline']);
    }
  };
  walk(body['outline']);

  return {
    title: textOf(asObject(opml['head'])?.['title']) || null,
    feeds,
    invalid,
    duplicates,
    truncated,
  };
}

export function serializeOpml(feeds: readonly OpmlFeed[], title = 'Statocyst Podcasts'): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<opml version="2.0">`,
    `  <head>`,
    `    <title>${escapeXml(title)}</title>`,
    `  </head>`,
    `  <body>`,
  ];
  for (const feed of feeds) {
    const attributes = [
      `type="rss"`,
      `text="${escapeXml(feed.title ?? feed.feedUrl)}"`,
      `title="${escapeXml(feed.title ?? feed.feedUrl)}"`,
      `xmlUrl="${escapeXml(feed.feedUrl)}"`,
    ];
    if (feed.siteUrl) attributes.push(`htmlUrl="${escapeXml(feed.siteUrl)}"`);
    lines.push(`    <outline ${attributes.join(' ')} />`);
  }
  lines.push('  </body>', '</opml>', '');
  return lines.join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const object = asObject(value);
  if (!object) return '';
  const text = object['#text'];
  return typeof text === 'string' || typeof text === 'number' ? String(text).trim() : '';
}

function attribute(value: unknown, name: string): string | undefined {
  const object = asObject(value);
  const raw = object?.[`@_${name}`];
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw) : undefined;
}
