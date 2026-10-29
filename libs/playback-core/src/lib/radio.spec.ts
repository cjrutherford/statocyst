import { describe, expect, it } from 'vitest';
import type { Track } from '@statocyst/contracts';
import { buildRadio, radioScore } from './radio';

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

describe('radio', () => {
  it('ranks same artist and genre above strangers and never includes the seed', () => {
    const seed = track('seed', 'Tool', { genre: 'Metal', year: 2001 });
    const library = [
      seed,
      track('same-artist', 'Tool', { genre: 'Metal', year: 2006 }),
      track('same-genre', 'Mastodon', { genre: 'Metal, Prog', year: 2009 }),
      track('other', 'Abba', { genre: 'Pop', year: 1976 }),
    ];
    expect(buildRadio(seed, library)).toEqual(['same-artist', 'same-genre', 'other']);
  });

  it('skips missing tracks, honours the limit and is deterministic', () => {
    const seed = track('s', 'A', { genre: 'Rock' });
    const library = [
      seed,
      ...Array.from({ length: 20 }, (_, i) => track(`c${i}`, `B${i}`, { genre: 'Rock' })),
      track('gone', 'A', { missing: true }),
    ];
    const ids = buildRadio(seed, library, new Set(), 6);
    expect(ids).toHaveLength(6);
    expect(ids).not.toContain('gone');
    expect(buildRadio(seed, library, new Set(), 6)).toEqual(ids);
  });

  it('still produces a radio for an untagged library', () => {
    const seed = track('s', '');
    const library = [seed, ...Array.from({ length: 5 }, (_, i) => track(`c${i}`, `Artist${i}`))];
    expect(buildRadio(seed, library)).toHaveLength(5);
  });

  it('adds a small bonus for favorites', () => {
    const seed = track('s', 'A');
    const other = track('o', 'B');
    expect(radioScore(seed, other, true)).toBeGreaterThan(radioScore(seed, other, false));
  });

  it('breaks up a run of the same artist when others exist', () => {
    const seed = track('s', 'Tool', { genre: 'Metal' });
    const library = [
      seed,
      ...Array.from({ length: 5 }, (_, i) => track(`a${i}`, 'Tool', { genre: 'Metal' })),
      ...Array.from({ length: 3 }, (_, i) => track(`b${i}`, 'Mastodon', { genre: 'Metal' })),
    ];
    const artists = buildRadio(seed, library).map((id) => library.find((t) => t.id === id)?.artist);
    expect(artists.slice(0, 5)).not.toContain(undefined);
    expect(artists[0] === artists[1] && artists[1] === artists[2]).toBe(false);
  });
});
