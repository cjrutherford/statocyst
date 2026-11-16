import { describe, expect, it } from 'vitest';
import type { Track } from '@statocyst/contracts';
import type { PlayedTrack } from './recent-tracks';
import { recentlyPlayed } from './recent-tracks';
import { recommendTracks } from './recommendation';

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

function played(track: Track, daysAgo: number, playCount = 1): PlayedTrack {
  return {
    track,
    playedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    playCount,
  };
}

describe('recentlyPlayed', () => {
  it('returns recorded plays newest first and skips missing or unplayed rows', () => {
    const library = [
      track('old', 'A', { lastPlayedAt: new Date(NOW - 9 * DAY).toISOString() }),
      track('new', 'B', { lastPlayedAt: new Date(NOW - DAY).toISOString(), playCount: 4 }),
      track('never', 'C'),
      track('gone', 'D', { lastPlayedAt: new Date(NOW).toISOString(), missing: true }),
    ];
    const recent = recentlyPlayed(library);
    expect(recent.map((entry) => entry.track.id)).toEqual(['new', 'old']);
    expect(recent[0]?.playCount).toBe(4);
  });

  it('honours the limit and ignores unparsable timestamps', () => {
    const library = [
      track('a', 'A', { lastPlayedAt: 'not-a-date' }),
      track('b', 'B', { lastPlayedAt: new Date(NOW).toISOString() }),
      track('c', 'C', { lastPlayedAt: new Date(NOW - DAY).toISOString() }),
    ];
    expect(recentlyPlayed(library, 1).map((entry) => entry.track.id)).toEqual(['b']);
  });
});

describe('recommendTracks', () => {
  it('ranks tracks by a favorite artist above unrelated artists', () => {
    const favorite = track('fav', 'Tool', { genre: 'Metal' });
    const library = [
      favorite,
      track('same-artist', 'Tool', { genre: 'Metal' }),
      track('same-genre', 'Mastodon', { genre: 'Metal' }),
      track('other', 'Abba', { genre: 'Pop' }),
    ];
    const result = recommendTracks({
      tracks: library,
      favorites: new Set(['fav']),
      now: NOW,
      limit: 4,
    });
    const sameArtist = result.findIndex((entry) => entry.trackId === 'same-artist');
    const other = result.findIndex((entry) => entry.trackId === 'other');
    expect(sameArtist).toBeGreaterThanOrEqual(0);
    expect(sameArtist).toBeLessThan(other);
    expect(result[sameArtist]?.reasons.map((reason) => reason.code)).toContain('artist-affinity');
  });

  it('prefers a not-recently-played song over one played a day ago', () => {
    const playedTrack = track('played', 'Tool', { genre: 'Metal' });
    const fresh = track('fresh', 'Tool', { genre: 'Metal' });
    const recent = [played(playedTrack, 1)];
    const result = recommendTracks({
      tracks: [playedTrack, fresh],
      recent,
      now: NOW,
      limit: 2,
    });
    expect(result.map((entry) => entry.trackId)).toEqual(['fresh', 'played']);
  });

  it('leaves a song played moments ago in Recently played rather than the mix', () => {
    const justPlayed = track('just-played', 'Tool', {
      genre: 'Metal',
      lastPlayedAt: new Date(NOW - 5 * 60_000).toISOString(),
    });
    const result = recommendTracks({
      tracks: [justPlayed, track('next', 'Tool', { genre: 'Metal' })],
      recent: [played(justPlayed, 0)],
      now: NOW,
    });
    expect(result.map((entry) => entry.trackId)).not.toContain('just-played');
    expect(result.map((entry) => entry.trackId)).toContain('next');
  });

  it('uses selected seed songs and explains the similarity', () => {
    const seed = track('seed', 'Tool', { genre: 'Metal' });
    const result = recommendTracks({
      tracks: [seed, track('similar', 'Tool', { genre: 'Metal' }), track('other', 'Abba')],
      seedTrackIds: ['seed'],
      now: NOW,
    });
    expect(result[0]?.trackId).toBe('similar');
    expect(result[0]?.reasons[0]?.code).toBe('seed-similarity');
    expect(result[0]?.reasons[0]?.label).toBe('Similar to Tseed');
    expect(result.some((entry) => entry.trackId === 'seed')).toBe(false);
  });

  it('skips missing and excluded tracks, respects the limit and is deterministic', () => {
    const library = [
      track('excluded', 'A'),
      track('gone', 'B', { missing: true }),
      ...Array.from({ length: 20 }, (_, index) => track(`c${index}`, `Artist${index % 6}`)),
    ];
    const input = {
      tracks: library,
      excludeTrackIds: new Set(['excluded']),
      now: NOW,
      limit: 6,
    };
    const first = recommendTracks(input);
    const second = recommendTracks(input);
    expect(first).toHaveLength(6);
    expect(first).toEqual(second);
    expect(first.map((entry) => entry.trackId)).not.toContain('excluded');
    expect(first.map((entry) => entry.trackId)).not.toContain('gone');
  });

  it('spreads the mix across artists', () => {
    const library = [
      ...Array.from({ length: 5 }, (_, index) => track(`tool-${index}`, 'Tool', { genre: 'Metal' })),
      ...Array.from({ length: 4 }, (_, index) =>
        track(`masto-${index}`, 'Mastodon', { genre: 'Metal' }),
      ),
    ];
    const result = recommendTracks({ tracks: library, now: NOW, limit: 4 });
    const counts = new Map<string, number>();
    for (const entry of result) {
      const artist = library.find((candidate) => candidate.id === entry.trackId)?.artist ?? '';
      counts.set(artist, (counts.get(artist) ?? 0) + 1);
    }
    expect([...counts.values()].every((count) => count <= 2)).toBe(true);
  });

  it('still returns picks for an untagged library', () => {
    const library = Array.from({ length: 5 }, (_, index) => track(`u${index}`, '', { album: '' }));
    const result = recommendTracks({ tracks: library, now: NOW, limit: 5 });
    expect(result).toHaveLength(5);
    expect(result.every((entry) => entry.reasons.length > 0)).toBe(true);
  });
});
