import type { Track } from '@statocyst/contracts';

/**
 * Local "song radio": ranks a library by how alike each track is to a seed from
 * metadata only. Mirrors RadioScorer.kt on Android; keep the weights in sync.
 */
export const RADIO_DEFAULT_LIMIT = 50;
const SAME_ARTIST = 40;
const SAME_ALBUM_ARTIST = 10;
const SAME_ALBUM = 25;
const SHARED_GENRE = 30;
const YEAR_CLOSE = 10;
const YEAR_NEAR = 5;
const FAVORITE = 5;
const MAX_RUN_BY_ARTIST = 2;

const norm = (text: string | null | undefined): string =>
  (text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const genres = (text: string | null | undefined): Set<string> =>
  new Set((text ?? '').split(/[,;/|]/).map(norm).filter((g) => g.length > 0));

/** Stable pseudo-random 0..4 so equal scores come out varied but repeatable. */
function jitter(seedId: string, id: string): number {
  let h = 0;
  const text = `${seedId}|${id}`;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return Math.abs(h) % 5;
}

export function radioScore(seed: Track, candidate: Track, favorite: boolean): number {
  let score = 0;
  const artist = norm(seed.artist);
  if (artist && artist === norm(candidate.artist)) score += SAME_ARTIST;
  const albumArtist = norm(seed.albumArtist);
  if (albumArtist && albumArtist === norm(candidate.albumArtist) && artist !== norm(candidate.artist)) {
    score += SAME_ALBUM_ARTIST;
  }
  const album = norm(seed.album);
  if (album && album === norm(candidate.album)) score += SAME_ALBUM;
  const sharedGenre = [...genres(seed.genre)].some((g) => genres(candidate.genre).has(g));
  if (sharedGenre) score += SHARED_GENRE;
  if (seed.year && candidate.year) {
    const gap = Math.abs(seed.year - candidate.year);
    score += gap <= 3 ? YEAR_CLOSE : gap <= 10 ? YEAR_NEAR : 0;
  }
  if (favorite) score += FAVORITE;
  return score;
}

/** Keeps one artist from filling several slots in a row when others are available. */
function diversify(ranked: Track[]): Track[] {
  const rest = [...ranked];
  const out: Track[] = [];
  while (rest.length > 0) {
    const last = out.length ? norm(out[out.length - 1].artist) : null;
    let run = 0;
    for (let i = out.length - 1; i >= 0 && norm(out[i].artist) === last; i -= 1) run += 1;
    let pick = 0;
    if (last !== null && run >= MAX_RUN_BY_ARTIST) {
      const other = rest.findIndex((t) => norm(t.artist) !== last);
      if (other >= 0) pick = other;
    }
    out.push(rest.splice(pick, 1)[0]);
  }
  return out;
}

/**
 * Up to `limit` track ids similar to `seed`, best first, never the seed.
 * Falls back to a stable shuffle so a small or untagged library still works.
 */
export function buildRadio(
  seed: Track,
  library: readonly Track[],
  favorites: ReadonlySet<string> = new Set(),
  limit = RADIO_DEFAULT_LIMIT,
): string[] {
  const ranked = library
    .filter((t) => t.id !== seed.id && !t.missing)
    .map((t) => ({ t, score: radioScore(seed, t, favorites.has(t.id)) * 10 + jitter(seed.id, t.id) }))
    .sort((a, b) => b.score - a.score || (a.t.id < b.t.id ? -1 : 1))
    .map((entry) => entry.t);
  return diversify(ranked)
    .slice(0, limit)
    .map((t) => t.id);
}
