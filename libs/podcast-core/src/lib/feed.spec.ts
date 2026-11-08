import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PodcastParseError, parsePodcastFeed, podcastPathKey } from '../index';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8');

const feedUrl = 'https://feeds.example.com/feed.xml';

describe('RSS podcast parsing', () => {
  it('decodes XML entities in channel metadata', async () => {
    const parsed = await parsePodcastFeed(
      `<rss version="2.0"><channel><title>Deep &amp; Wide</title>` +
        `<itunes:author>Mile &amp; Audio</itunes:author>` +
        `<link>https://example.com</link><description>x</description></channel></rss>`,
      { feedUrl },
    );
    expect(parsed.title).toBe('Deep & Wide');
    expect(parsed.author).toBe('Mile & Audio');
  });
  it('parses channel metadata and episodes', async () => {
    const parsed = await parsePodcastFeed(fixture('rss-basic.xml'), { feedUrl });
    expect(parsed.feedType).toBe('rss');
    expect(parsed.title).toBe('Deep Water Radio');
    expect(parsed.author).toBe('Statocyst Studio');
    expect(parsed.siteUrl).toBe('https://example.com/deep-water');
    expect(parsed.imageUrl).toBe('https://example.com/deep-water.jpg');
    expect(parsed.descriptionText).toContain('A show & notes');
    expect(parsed.categories).toEqual(['Science', 'Nature']);
    expect(parsed.explicit).toBe(false);
    expect(parsed.dropped).toBe(1);
    expect(parsed.truncated).toBe(0);
    expect(parsed.warnings.length).toBeGreaterThan(0);
    expect(parsed.episodes).toHaveLength(2);
    expect(parsed.episodes.map((episode) => episode.title)).toEqual([
      'Episode Two',
      'Episode One',
    ]);
  });

  it('normalizes duration, dates, seasons, explicit flag and media links', async () => {
    const parsed = await parsePodcastFeed(fixture('rss-basic.xml'), { feedUrl });
    const episode = parsed.episodes.find((entry) => entry.guid === 'ep-1');
    expect(episode).toBeDefined();
    expect(episode?.enclosureUrl).toBe('https://cdn.example.com/1.mp3');
    expect(episode?.enclosureType).toBe('audio/mpeg');
    expect(episode?.enclosureLengthBytes).toBe(42_000_000);
    expect(episode?.durationMs).toBe(3_723_000);
    expect(episode?.publishedAt).toBe('2026-10-01T08:00:00.000Z');
    expect(episode?.seasonNo).toBe(2);
    expect(episode?.episodeNo).toBe(1);
    expect(episode?.episodeType).toBe('full');
    expect(episode?.explicit).toBe(true);
    expect(episode?.imageUrl).toBe('https://example.com/ep1.jpg');
    expect(episode?.chaptersUrl).toBe('https://example.com/1.chapters.json');
    expect(episode?.transcriptUrl).toBe('https://example.com/1.vtt');
    expect(episode?.transcriptType).toBe('text/vtt');
    expect(episode?.descriptionText).not.toContain('alert(1)');
    expect(episode?.links).toEqual([
      { title: 'Read', url: 'https://example.com/notes/1' },
    ]);
    expect(episode?.pathKey).toMatch(/^podcast:[a-f0-9]{64}$/);
  });

  it('resolves relative enclosure URLs against the feed URL', async () => {
    const parsed = await parsePodcastFeed(fixture('rss-basic.xml'), { feedUrl });
    const episode = parsed.episodes.find((entry) => entry.guid === 'ep-2');
    expect(episode?.enclosureUrl).toBe('https://feeds.example.com/media/2.mp3');
    expect(episode?.durationMs).toBe(2_730_000);
  });

  it('produces a stable path key for the same feed URL and GUID', async () => {
    expect(await podcastPathKey(feedUrl, 'ep-1')).toBe(await podcastPathKey(feedUrl, 'ep-1'));
    expect(await podcastPathKey(feedUrl, 'ep-1')).not.toBe(await podcastPathKey(feedUrl, 'ep-2'));
  });
});

describe('Atom podcast parsing', () => {
  it('parses feed metadata, enclosure links and escaped HTML', async () => {
    const parsed = await parsePodcastFeed(fixture('atom-basic.xml'), { feedUrl });
    expect(parsed.feedType).toBe('atom');
    expect(parsed.title).toBe('Atom Deep');
    expect(parsed.author).toBe('Atom Studio');
    expect(parsed.siteUrl).toBe('https://example.com/atom');
    expect(parsed.imageUrl).toBe('https://example.com/icon.png');
    expect(parsed.descriptionText).toBe('An Atom podcast feed.');
    expect(parsed.episodes).toHaveLength(1);
    const episode = parsed.episodes[0];
    expect(episode.guid).toBe('atom-ep-1');
    expect(episode.enclosureUrl).toBe('https://cdn.example.com/atom1.m4a');
    expect(episode.enclosureType).toBe('audio/mp4');
    expect(episode.enclosureLengthBytes).toBe(12_345);
    expect(episode.durationMs).toBe(2_730_000);
    expect(episode.seasonNo).toBe(1);
    expect(episode.episodeNo).toBe(4);
    expect(episode.episodeType).toBe('bonus');
    expect(episode.link).toBe('https://example.com/atom/1');
    expect(episode.descriptionText).toBe('Summary & notes Notes');
    expect(episode.links).toEqual([
      { title: 'Notes', url: 'https://feeds.example.com/atom/notes' },
    ]);
  });
});

describe('hostile and malformed input', () => {
  it('rejects DTD and entity declarations', async () => {
    await expect(
      parsePodcastFeed(fixture('xxe.xml'), { feedUrl }),
    ).rejects.toMatchObject({ code: 'DOCTYPE' });
    await expect(parsePodcastFeed(fixture('xxe.xml'), { feedUrl })).rejects.toBeInstanceOf(
      PodcastParseError,
    );
  });

  it('rejects empty, oversized and non-feed documents', async () => {
    await expect(parsePodcastFeed('', { feedUrl })).rejects.toMatchObject({ code: 'EMPTY' });
    await expect(
      parsePodcastFeed('<rss><channel><title>x</title></channel></rss>', {
        feedUrl,
        maxBytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await expect(parsePodcastFeed('<root />', { feedUrl })).rejects.toMatchObject({
      code: 'NOT_A_FEED',
    });
    await expect(parsePodcastFeed(fixture('malformed.xml'), { feedUrl })).rejects.toMatchObject({
      code: 'MALFORMED_XML',
    });
  });

  it('drops private enclosures unless local networking is enabled', async () => {
    const xml = rssFeed([
      item('private', 'http://127.0.0.1:8080/audio.mp3'),
    ]);
    const blocked = await parsePodcastFeed(xml, { feedUrl });
    expect(blocked.episodes).toHaveLength(0);
    expect(blocked.dropped).toBe(1);
    const allowed = await parsePodcastFeed(xml, { feedUrl, allowLocalNetwork: true });
    expect(allowed.episodes).toHaveLength(1);
  });

  it('caps episodes to the newest N and dedupes GUIDs', async () => {
    const xml = rssFeed([
      item('a', 'https://cdn.example.com/a.mp3', '2026-01-01T00:00:00Z', 'same'),
      item('b', 'https://cdn.example.com/b.mp3', '2026-01-02T00:00:00Z', 'same'),
      item('c', 'https://cdn.example.com/c.mp3', '2026-01-03T00:00:00Z', 'c'),
      item('d', 'https://cdn.example.com/d.mp3', '2026-01-04T00:00:00Z', 'd'),
    ]);
    const parsed = await parsePodcastFeed(xml, { feedUrl, maxEpisodes: 2 });
    expect(parsed.episodes).toHaveLength(2);
    expect(parsed.episodes.map((episode) => episode.guid)).toEqual(['d', 'c']);
    expect(parsed.truncated).toBe(1);
    expect(parsed.dropped).toBe(1);
  });
});

function item(
  title: string,
  enclosure: string,
  date = '2026-01-01T00:00:00Z',
  guid = title,
): string {
  return `<item><title>${title}</title><guid>${guid}</guid><pubDate>${date}</pubDate>` +
    `<enclosure url="${enclosure}" type="audio/mpeg" /></item>`;
}

function rssFeed(items: readonly string[]): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel>` +
    `<title>Generated</title>${items.join('')}</channel></rss>`;
}
