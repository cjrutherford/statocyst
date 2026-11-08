import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOpml, serializeOpml } from '../index';

const opml = readFileSync(new URL('../../fixtures/opml-basic.opml', import.meta.url), 'utf8');

describe('OPML', () => {
  it('parses nested outlines, dedupes and reports invalid feeds', () => {
    const parsed = parseOpml(opml);
    expect(parsed.title).toBe('My Podcasts');
    expect(parsed.feeds.map((feed) => feed.feedUrl)).toEqual([
      'https://feeds.example.com/deep-water.xml',
      'https://feeds.example.com/atom.xml',
    ]);
    expect(parsed.duplicates).toBe(1);
    expect(parsed.invalid).toBe(1);
    expect(parsed.truncated).toBe(false);
    expect(parsed.feeds[0].title).toBe('Deep Water Radio');
    expect(parsed.feeds[0].siteUrl).toBe('https://example.com/deep-water');
  });

  it('allows local feeds when explicitly enabled and caps imports', () => {
    const parsed = parseOpml(opml, { allowLocalNetwork: true });
    expect(parsed.feeds).toHaveLength(3);
    expect(parsed.invalid).toBe(0);
    const capped = parseOpml(opml, { allowLocalNetwork: true, maxFeeds: 1 });
    expect(capped.feeds).toHaveLength(1);
    expect(capped.truncated).toBe(true);
  });

  it('round-trips through serialization without losing feed identity', () => {
    const parsed = parseOpml(opml, { allowLocalNetwork: true });
    const xml = serializeOpml(parsed.feeds, 'Round trip');
    const restored = parseOpml(xml, { allowLocalNetwork: true });
    expect(restored.title).toBe('Round trip');
    expect(restored.feeds.map((feed) => feed.feedUrl)).toEqual(
      parsed.feeds.map((feed) => feed.feedUrl),
    );
    expect(xml).toContain('type="rss"');
    const escaped = serializeOpml([
      { title: 'A & B', feedUrl: 'https://example.com/feed?a=1&b=2', siteUrl: null },
    ]);
    expect(escaped).toContain('&amp;');
  });

  it('rejects DTD, empty and non-OPML documents', () => {
    expect(() => parseOpml('')).toThrowError(/empty/i);
    expect(() => parseOpml('<!DOCTYPE opml><opml />')).toThrowError(/DTD/i);
    expect(() => parseOpml('<rss />')).toThrowError(/OPML/i);
  });
});
