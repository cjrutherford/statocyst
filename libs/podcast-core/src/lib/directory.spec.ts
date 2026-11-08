import { describe, expect, it } from 'vitest';
import {
  dedupeDirectoryResults,
  buildPodcastDiscovery,
  parseAppleSearch,
  parseAppleTopCharts,
  parseFyydSearch,
  directorySourceLabel,
} from '../index';

describe('podcast discovery providers', () => {
  it('normalizes Apple Podcasts search results', () => {
    const results = parseAppleSearch({
      resultCount: 1,
      results: [
        {
          collectionId: 42,
          collectionName: 'Deep Water Radio',
          artistName: 'Statocyst Studio',
          feedUrl: 'https://feeds.example.com/deep.xml',
          artworkUrl100: 'https://example.com/art.jpg',
          trackCount: 12,
          collectionExplicitness: 'explicit',
          primaryGenreName: 'Science',
        },
      ],
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      feedUrl: 'https://feeds.example.com/deep.xml',
      source: 'apple',
      providerId: '42',
      title: 'Deep Water Radio',
      author: 'Statocyst Studio',
      artworkUrl: 'https://example.com/art.jpg',
      episodeCount: 12,
      explicit: true,
      categories: ['Science'],
    });
    expect(directorySourceLabel('apple')).toBe('Apple Podcasts');
  });

  it('normalizes Fyyd results and skips invalid feeds', () => {
    const results = parseFyydSearch({
      status: 1,
      data: [
        {
          id: 7,
          title: 'Fyyd Deep',
          xmlURL: 'https://feeds.example.com/fyyd.xml',
          author: 'Fyyd Author',
          description: 'A Fyyd result',
          imgURL: 'https://example.com/fyyd.jpg',
        },
        { id: 8, title: 'No feed', xmlURL: 'javascript:alert(1)' },
      ],
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: 'fyyd',
      providerId: '7',
      title: 'Fyyd Deep',
      descriptionText: 'A Fyyd result',
    });
  });

  it('dedupes by feed URL and keeps the richer metadata', () => {
    const apple = parseAppleSearch({
      results: [
        {
          collectionId: 1,
          collectionName: 'Same Show',
          artistName: 'Apple Author',
          feedUrl: 'https://feeds.example.com/same.xml',
        },
      ],
    })[0];
    const fyyd = parseFyydSearch({
      data: [
        {
          id: 2,
          title: 'Same Show',
          xmlURL: 'https://feeds.example.com/same.xml',
          author: 'Fyyd Author',
          description: 'Richer Fyyd description',
        },
      ],
    })[0];
    const merged = dedupeDirectoryResults([apple, fyyd]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('apple');
    expect(merged[0].descriptionText).toBe('Richer Fyyd description');
  });

  it('parses the legacy iTunes top-podcasts feed', () => {
    const chart = parseAppleTopCharts({
      feed: {
        entry: [
          {
            'im:name': { label: 'The Daily' },
            'im:artist': { label: 'The New York Times' },
            'im:image': [{ label: 'small.jpg' }, { label: 'large.jpg' }],
            category: { attributes: { term: 'News' } },
            id: {
              label: 'https://podcasts.apple.com/us/podcast/the-daily/id1200361736',
              attributes: { 'im:id': '1200361736' },
            },
          },
        ],
      },
    });
    expect(chart).toEqual([
      {
        providerId: '1200361736',
        title: 'The Daily',
        author: 'The New York Times',
        artworkUrl: 'large.jpg',
        categories: ['News'],
      },
    ]);
  });

  it('builds top shows, categories and shelves from the chart and lookup', () => {
    const discovery = buildPodcastDiscovery(
      {
        feed: {
          results: [
            {
              id: '1',
              name: 'Chart Deep',
              artistName: 'Chart Studio',
              artworkUrl100: 'https://example.com/chart.jpg',
              genres: [{ name: 'Science' }, { name: 'News' }],
            },
            {
              id: '2',
              name: 'Chart News',
              artistName: 'News Studio',
              genres: [{ name: 'News' }],
            },
            {
              id: '3',
              name: 'Unresolved',
              artistName: 'Ghost',
              genres: [{ name: 'Science' }],
            },
          ],
        },
      },
      {
        resultCount: 2,
        results: [
          {
            collectionId: 1,
            collectionName: 'Chart Deep',
            artistName: 'Chart Studio',
            feedUrl: 'https://feeds.example.com/deep.xml',
            trackCount: 9,
            primaryGenreName: 'Science',
          },
          {
            collectionId: 2,
            collectionName: 'Chart News',
            artistName: 'News Studio',
            feedUrl: 'https://feeds.example.com/news.xml',
            trackCount: 4,
            primaryGenreName: 'News',
          },
        ],
      },
    );

    expect(discovery.top.map((show) => show.title)).toEqual(['Chart Deep', 'Chart News']);
    expect(discovery.top[0].categories).toEqual(['Science', 'News']);
    expect(discovery.categories).toEqual([
      { id: 'news', name: 'News', count: 2 },
      { id: 'science', name: 'Science', count: 2 },
    ]);
    expect(discovery.shelves).toHaveLength(1);
    expect(discovery.shelves[0].category.name).toBe('News');
    expect(discovery.shelves[0].shows.map((show) => show.title)).toEqual([
      'Chart Deep',
      'Chart News',
    ]);
  });
});
