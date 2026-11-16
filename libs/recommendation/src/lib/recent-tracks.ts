import type { Track } from '@statocyst/contracts';

/** Enough for a useful history section without turning the list into a catalog dump. */
export const DEFAULT_RECENT_LIMIT = 30;

export interface PlayedTrack {
  track: Track;
  /** ISO-8601 timestamp from listening history. */
  playedAt: string;
  /** Local play count when the host records one; 0 when it does not. */
  playCount: number;
}

function playedAtMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The music tracks with a recorded play, newest first. Missing tracks and rows
 * without a usable timestamp are skipped. Pure and deterministic so the
 * playlist screen and the recommendation engine share one definition.
 */
export function recentlyPlayed(
  tracks: readonly Track[],
  limit = DEFAULT_RECENT_LIMIT,
): PlayedTrack[] {
  const bounded = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : DEFAULT_RECENT_LIMIT;
  if (bounded === 0) return [];
  return tracks
    .filter(
      (track) =>
        !track.missing &&
        typeof track.lastPlayedAt === 'string' &&
        playedAtMs(track.lastPlayedAt) > 0,
    )
    .map((track) => ({
      track,
      playedAt: track.lastPlayedAt as string,
      playCount: Math.max(0, Math.trunc(track.playCount ?? 0)),
    }))
    .sort(
      (a, b) =>
        playedAtMs(b.playedAt) - playedAtMs(a.playedAt) || a.track.id.localeCompare(b.track.id),
    )
    .slice(0, bounded);
}

/** ISO date of the newest recorded play, or null when the library has no history. */
export function lastPlayedAt(tracks: readonly Track[]): string | null {
  let newest = 0;
  let value: string | null = null;
  for (const track of tracks) {
    if (track.missing || typeof track.lastPlayedAt !== 'string') continue;
    const at = playedAtMs(track.lastPlayedAt);
    if (at > newest) {
      newest = at;
      value = track.lastPlayedAt;
    }
  }
  return value;
}
