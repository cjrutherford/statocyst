import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CarRecommendationSnapshot, Track } from '@statocyst/contracts';
import { buildCarRecommendationSnapshot } from './car-mixes';

interface GoldenFixture {
  now: string;
  tracks: Array<{
    id: string;
    title: string;
    artist: string;
    album: string;
    albumArtist: string;
    genre: string;
    year: number;
    lastPlayedAt: string | null;
    playCount: number;
    missing: boolean;
  }>;
  favorites: string[];
  recent: Array<{ trackId: string; playedAt: string; playCount: number }>;
  expected: CarRecommendationSnapshot;
}

const fixture = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../fixtures/car-recommendation-golden.json'),
    'utf8',
  ),
) as GoldenFixture;

const tracks: Track[] = fixture.tracks.map((track) => ({
  ...track,
  durationMs: 200_000,
  artworkUrl: null,
  sourceId: 'local',
  sourceLabel: 'Local',
}));
const byId = new Map(tracks.map((track) => [track.id, track]));
const recent = fixture.recent.map((entry) => ({
  track: byId.get(entry.trackId)!,
  playedAt: entry.playedAt,
  playCount: entry.playCount,
}));

describe('car recommendation golden fixture', () => {
  it('matches the shared four-mix snapshot used by Kotlin and Swift', () => {
    const actual = buildCarRecommendationSnapshot(
      {
        tracks,
        favorites: new Set(fixture.favorites),
        recent,
      },
      Date.parse(fixture.now),
    );
    expect(actual).toEqual(fixture.expected);
  });
});
