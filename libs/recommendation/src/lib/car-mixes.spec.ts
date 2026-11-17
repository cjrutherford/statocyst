import { describe, expect, it } from 'vitest';
import { CAR_RECOMMENDATION_VERSION, type Track } from '@statocyst/contracts';
import { buildCarRecommendationSnapshot } from './car-mixes';
import type { PlayedTrack } from './recent-tracks';

const NOW = Date.parse('2026-11-16T12:00:00.000Z');
const DAY = 86_400_000;

function track(id: string, artist: string, extra: Partial<Track> = {}): Track {
  return {
    id,
    title: `T${id}`,
    artist,
    album: `album-${id}`,
    albumArtist: artist,
    durationMs: 1000,
    artworkUrl: null,
    sourceId: 'local',
    sourceLabel: 'Local',
    missing: false,
    ...extra,
  };
}

function played(track: Track, daysAgo: number): PlayedTrack {
  return {
    track,
    playedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    playCount: 2,
  };
}

describe('buildCarRecommendationSnapshot', () => {
  it('publishes the four car mixes in order with reasons', () => {
    const old = track('old', 'Tool', {
      genre: 'Metal',
      lastPlayedAt: new Date(NOW - 60 * DAY).toISOString(),
    });
    const favorite = track('fav', 'Mastodon', { genre: 'Metal' });
    const fresh = track('fresh', 'Tool', { genre: 'Metal' });
    const result = buildCarRecommendationSnapshot(
      {
        tracks: [old, favorite, fresh],
        favorites: new Set(['fav']),
        recent: [played(old, 60), played(fresh, 1)],
      },
      NOW,
    );

    expect(result.version).toBe(CAR_RECOMMENDATION_VERSION);
    expect(result.generatedAt).toBe(new Date(NOW).toISOString());
    expect(result.mixes.map((mix) => mix.id)).toEqual([
      'daily-drift',
      'rediscover',
      'deep-cuts',
      'favorites-radio',
    ]);
    expect(result.mixes[0]!.trackIds.length).toBeGreaterThan(0);
    expect(result.mixes[0]!.reasons[result.mixes[0]!.trackIds[0]!]).toBeTruthy();
    expect(result.mixes[1]!.trackIds).toContain('old');
    expect(result.mixes[3]!.trackIds).toContain('fav');
    expect(result.mixes[3]!.reasons['fav']).toBe('In your favorites');
  });

  it('omits mixes with no candidates and never includes missing tracks', () => {
    const gone = track('gone', 'Tool', { missing: true });
    const result = buildCarRecommendationSnapshot(
      {
        tracks: [track('a', 'Tool'), gone],
        favorites: new Set(['gone']),
        recent: [],
      },
      NOW,
    );
    expect(result.mixes.map((mix) => mix.id)).toEqual(['daily-drift']);
    expect(result.mixes.flatMap((mix) => mix.trackIds)).not.toContain('gone');
  });

  it('is deterministic for the same clock and catalog', () => {
    const library = Array.from({ length: 8 }, (_, index) => track(`t${index}`, `Artist${index % 3}`));
    const input = { tracks: library, now: NOW };
    expect(buildCarRecommendationSnapshot(input, NOW)).toEqual(
      buildCarRecommendationSnapshot(input, NOW),
    );
  });
});
