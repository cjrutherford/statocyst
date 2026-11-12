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
    expect(episode?.mediaForm).toBe('audio');
    expect(episode?.alternates).toEqual([]);
    expect(episode?.posterUrl).toBe('https://example.com/ep1.jpg');
    expect(episode?.videoWidth).toBeNull();
    expect(episode?.videoHeight).toBeNull();
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
    expect(episode.mediaForm).toBe('audio');
    expect(episode.alternates).toEqual([]);
    expect(episode.posterUrl).toBeNull();
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

describe('video enclosure parsing', () => {
  it('prefers audio and keeps the video as a classified alternate', async () => {
    const parsed = await parsePodcastFeed(fixture('rss-video.xml'), { feedUrl });
    const episode = parsed.episodes.find((entry) => entry.guid === 'both');
    expect(episode).toBeDefined();
    expect(episode?.mediaForm).toBe('audio');
    expect(episode?.enclosureUrl).toBe('https://cdn.example.com/both.mp3');
    expect(episode?.enclosureType).toBe('audio/mpeg');
    expect(episode?.enclosureLengthBytes).toBe(48_230_000);
    expect(episode?.alternates).toEqual([
      {
        url: 'https://cdn.example.com/both.mp4',
        type: 'video/mp4',
        form: 'video',
        lengthBytes: null,
        width: 1920,
        height: 1080,
        bitrate: 1_500_000,
      },
    ]);
    expect(episode?.posterUrl).toBe('https://example.com/thumbs/both.jpg');
    expect(episode?.videoWidth).toBe(1920);
    expect(episode?.videoHeight).toBe(1080);
  });

  it('uses video as the primary when only video is advertised', async () => {
    const parsed = await parsePodcastFeed(fixture('rss-video.xml'), { feedUrl });
    const episode = parsed.episodes.find((entry) => entry.guid === 'video-only');
    expect(episode).toBeDefined();
    expect(episode?.mediaForm).toBe('video');
    expect(episode?.enclosureUrl).toBe('https://cdn.example.com/only.mp4');
    expect(episode?.enclosureType).toBeNull();
    expect(episode?.enclosureLengthBytes).toBe(90_000_000);
    expect(episode?.alternates).toEqual([]);
    expect(episode?.videoWidth).toBe(640);
    expect(episode?.videoHeight).toBe(360);
    // Episode art wins over the landscape thumbnail.
    expect(episode?.imageUrl).toBe('https://example.com/thumbs/only.jpg');
    expect(episode?.posterUrl).toBe('https://example.com/thumbs/only.jpg');
  });

  it('collects multiple media:content entries and resolves relative URLs', async () => {
    const parsed = await parsePodcastFeed(fixture('rss-video.xml'), { feedUrl });
    const episode = parsed.episodes.find((entry) => entry.guid === 'multi');
    expect(episode).toBeDefined();
    expect(episode?.mediaForm).toBe('audio');
    expect(episode?.enclosureUrl).toBe('https://feeds.example.com/media/m2.m4a');
    expect(episode?.enclosureType).toBe('audio/mp4');
    expect(episode?.enclosureLengthBytes).toBe(1_000);
    expect(episode?.alternates.map((alternate) => alternate.url)).toEqual([
      'https://cdn.example.com/m1.mp4',
      'https://cdn.example.com/m3.mp4',
    ]);
    // application/octet-stream alone is audio, but medium="video" wins.
    expect(episode?.alternates[0]).toMatchObject({
      form: 'video',
      type: 'application/octet-stream',
      width: 1280,
      height: 720,
    });
    expect(episode?.alternates.every((alternate) => alternate.form === 'video')).toBe(true);
    expect(episode?.videoWidth).toBe(1280);
    expect(episode?.videoHeight).toBe(720);
    expect(episode?.posterUrl).toBeNull();
  });

  it('parses Podcast 2.0 alternate enclosures', async () => {
    const parsed = await parsePodcastFeed(fixture('rss-video.xml'), { feedUrl });
    const episode = parsed.episodes.find((entry) => entry.guid === 'alternate');
    expect(episode).toBeDefined();
    expect(episode?.mediaForm).toBe('video');
    expect(episode?.enclosureUrl).toBe('https://cdn.example.com/alt.mp4');
    expect(episode?.enclosureType).toBe('video/mp4');
    expect(episode?.enclosureLengthBytes).toBe(120_000_000);
    expect(episode?.alternates).toEqual([]);
  });

  it('bounds alternates to 8 and still retains the video form', async () => {
    const audioAlternates = Array.from(
      { length: 9 },
      (_, index) =>
        `<media:content url="https://cdn.example.com/a${index}.mp3" type="audio/mpeg" />`,
    ).join('');
    const xml =
      `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">` +
      `<channel><title>Oversized</title><item><title>Capped</title><guid>capped</guid>` +
      `<enclosure url="https://cdn.example.com/primary.mp3" type="audio/mpeg" />` +
      audioAlternates +
      `<media:content url="https://cdn.example.com/late.mp4" type="video/mp4" />` +
      `</item></channel></rss>`;
    const parsed = await parsePodcastFeed(xml, { feedUrl });
    const episode = parsed.episodes[0];
    expect(episode.mediaForm).toBe('audio');
    expect(episode.alternates).toHaveLength(8);
    expect(episode.alternates.some((alternate) => alternate.url === episode.enclosureUrl)).toBe(
      false,
    );
    expect(episode.alternates.filter((alternate) => alternate.form === 'audio')).toHaveLength(7);
    expect(episode.alternates).toContainEqual(
      expect.objectContaining({ url: 'https://cdn.example.com/late.mp4', form: 'video' }),
    );
  });

  it('does not assume application/octet-stream or a bad MIME is video', async () => {
    const xml =
      `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">` +
      `<channel><title>MIME</title>` +
      `<item><title>Octet</title><guid>octet</guid>` +
      `<media:content url="https://cdn.example.com/download" type="application/octet-stream" />` +
      `</item>` +
      `<item><title>Bad type</title><guid>bad-type</guid>` +
      `<media:content url="https://cdn.example.com/audio.mp3" type="video" />` +
      `</item>` +
      `<item><title>Real video</title><guid>real-video</guid>` +
      `<media:content url="https://cdn.example.com/movie.webm" type="video/webm" />` +
      `</item></channel></rss>`;
    const parsed = await parsePodcastFeed(xml, { feedUrl });
    expect(parsed.episodes.find((entry) => entry.guid === 'octet')?.mediaForm).toBe('audio');
    expect(parsed.episodes.find((entry) => entry.guid === 'bad-type')?.mediaForm).toBe('audio');
    expect(parsed.episodes.find((entry) => entry.guid === 'real-video')?.mediaForm).toBe('video');
  });

  it('rejects non-HTTP(S) and SSRF enclosures on every advertised form', async () => {
    const xml = rssFeed([
      `<item><title>Private only</title><guid>private-only</guid>` +
        `<media:content url="http://10.0.0.5/video.mp4" type="video/mp4" />` +
        `<media:thumbnail url="http://127.0.0.1/poster.jpg" /></item>`,
      `<item><title>FTP</title><guid>ftp</guid>` +
        `<enclosure url="ftp://cdn.example.com/episode.mp3" type="audio/mpeg" /></item>`,
      `<item><title>Safe audio</title><guid>safe</guid>` +
        `<enclosure url="https://cdn.example.com/safe.mp3" type="audio/mpeg" />` +
        `<media:content url="http://192.168.1.5/private.mp4" type="video/mp4" />` +
        `<media:thumbnail url="http://169.254.169.254/latest/meta-data" /></item>`,
    ]);
    const parsed = await parsePodcastFeed(xml, { feedUrl });
    expect(parsed.dropped).toBe(2);
    expect(parsed.episodes).toHaveLength(1);
    const episode = parsed.episodes[0];
    expect(episode.guid).toBe('safe');
    expect(episode.mediaForm).toBe('audio');
    expect(episode.alternates).toEqual([]);
    expect(episode.posterUrl).toBeNull();
  });

  it('parses Atom enclosure links and media:content with audio-first selection', async () => {
    const xml =
      `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" ` +
      `xmlns:media="http://search.yahoo.com/mrss/"><title>Atom Video</title>` +
      `<entry><id>atom-video</id><title>Atom Video Episode</title>` +
      `<link rel="enclosure" href="https://cdn.example.com/atom.mp4" type="video/mp4" />` +
      `<link rel="enclosure" href="https://cdn.example.com/atom.m4a" type="audio/mp4" length="42" />` +
      `<media:content url="https://cdn.example.com/atom-extra.mp4" type="video/mp4" width="1280" height="720" />` +
      `<media:thumbnail url="https://example.com/atom-thumb.jpg" />` +
      `</entry></feed>`;
    const parsed = await parsePodcastFeed(xml, { feedUrl });
    expect(parsed.episodes).toHaveLength(1);
    const episode = parsed.episodes[0];
    expect(episode.mediaForm).toBe('audio');
    expect(episode.enclosureUrl).toBe('https://cdn.example.com/atom.m4a');
    expect(episode.enclosureLengthBytes).toBe(42);
    expect(episode.alternates.map((alternate) => alternate.url)).toEqual([
      'https://cdn.example.com/atom.mp4',
      'https://cdn.example.com/atom-extra.mp4',
    ]);
    expect(episode.posterUrl).toBe('https://example.com/atom-thumb.jpg');
    expect(episode.videoWidth).toBe(1280);
    expect(episode.videoHeight).toBe(720);
  });

  it('drops duplicate enclosure URLs and never repeats the primary', async () => {
    const xml = rssFeed([
      `<item><title>Duplicate</title><guid>duplicate</guid>` +
        `<enclosure url="https://cdn.example.com/same.mp4" type="video/mp4" />` +
        `<media:content url="https://cdn.example.com/same.mp4" type="video/mp4" width="1920" height="1080" />` +
        `<media:content url="https://cdn.example.com/other.mp4" type="video/mp4" />` +
        `</item>`,
    ]);
    const parsed = await parsePodcastFeed(xml, { feedUrl });
    const episode = parsed.episodes[0];
    expect(episode.mediaForm).toBe('video');
    expect(episode.enclosureUrl).toBe('https://cdn.example.com/same.mp4');
    expect(episode.alternates).toHaveLength(1);
    expect(episode.alternates[0].url).toBe('https://cdn.example.com/other.mp4');
    // Metadata from the duplicate media:content still enriches the primary.
    expect(episode.videoWidth).toBe(1920);
    expect(episode.videoHeight).toBe(1080);
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
  return `<?xml version="1.0"?><rss version="2.0"` +
    ` xmlns:media="http://search.yahoo.com/mrss/"` +
    ` xmlns:podcast="https://podcastindex.org/namespace/1.0">` +
    `<channel><title>Generated</title>${items.join('')}</channel></rss>`;
}
