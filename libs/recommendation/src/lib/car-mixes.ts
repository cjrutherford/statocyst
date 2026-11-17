import {
  CAR_RECOMMENDATION_VERSION,
  type CarMix,
  type CarRecommendationSnapshot,
  type Track,
} from '@statocyst/contracts';
import type { PlayedTrack } from './recent-tracks';
import { recommendTracks, type Recommendation } from './recommendation';

const MIX_LIMIT = 12;
/** Request extra rows so reason-specific mixes still have enough candidates. */
const CANDIDATE_LIMIT = 80;

export interface CarMixInput {
  tracks: readonly Track[];
  favorites?: ReadonlySet<string>;
  recent?: readonly PlayedTrack[];
  now?: number;
  limit?: number;
}

function reasonMap(
  recommendations: readonly Recommendation[],
  fallback: (trackId: string) => string,
): Record<string, string> {
  const reasons: Record<string, string> = {};
  for (const recommendation of recommendations) {
    reasons[recommendation.trackId] =
      recommendation.reasons[0]?.label ?? fallback(recommendation.trackId);
  }
  return reasons;
}

function mix(
  id: string,
  title: string,
  subtitle: string,
  trackIds: readonly string[],
  reasons: Record<string, string>,
): CarMix | null {
  const unique = [...new Set(trackIds)].slice(0, MIX_LIMIT);
  if (unique.length === 0) return null;
  const mixReasons: Record<string, string> = {};
  for (const trackId of unique) mixReasons[trackId] = reasons[trackId] ?? 'For you';
  return { id, title, subtitle, trackIds: unique, reasons: mixReasons };
}

/**
 * Four car-ready mixes from the same local ranking used by the Playlists screen.
 * The first mix is the default "For you" list. Empty mixes are omitted so the
 * car never opens a dead end.
 */
export function buildCarRecommendationSnapshot(
  input: CarMixInput,
  now = input.now ?? Date.now(),
): CarRecommendationSnapshot {
  const favorites = input.favorites ?? new Set<string>();
  const ranked = recommendTracks({
    tracks: input.tracks,
    favorites,
    recent: input.recent,
    now,
    limit: Math.max(input.limit ?? MIX_LIMIT, CANDIDATE_LIMIT),
  });
  const byId = new Map(input.tracks.filter((track) => !track.missing).map((track) => [track.id, track]));
  const rankedIndex = new Map(ranked.map((entry, index) => [entry.trackId, index]));

  const daily = ranked.slice(0, MIX_LIMIT);
  const rediscoverIds = new Set(
    input.tracks
      .filter((track) => {
        if (track.missing) return false;
        if (favorites.has(track.id) && !track.lastPlayedAt) return true;
        if (typeof track.lastPlayedAt !== 'string') return false;
        const at = Date.parse(track.lastPlayedAt);
        return Number.isFinite(at) && now - at > 30 * 86_400_000;
      })
      .map((track) => track.id),
  );
  const rediscover = ranked
    .filter((entry) => rediscoverIds.has(entry.trackId))
    .slice(0, MIX_LIMIT);
  const deepCuts = ranked
    .filter((entry) =>
      entry.reasons.some(
        (reason) => reason.code === 'artist-affinity' || reason.code === 'album-affinity',
      ),
    )
    .slice(0, MIX_LIMIT);

  const favoriteTracks = [...favorites]
    .map((id) => byId.get(id))
    .filter((track): track is Track => !!track)
    .sort((a, b) => {
      const left = rankedIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const right = rankedIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return left - right || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    })
    .slice(0, MIX_LIMIT);

  const mixes = [
    mix(
      'daily-drift',
      'Daily drift',
      "Favorites + today's plays",
      daily.map((entry) => entry.trackId),
      reasonMap(daily, () => 'Picked for you'),
    ),
    mix(
      'rediscover',
      'Rediscover',
      'Not played in 30+ days',
      rediscover.map((entry) => entry.trackId),
      Object.fromEntries(
        rediscover.map((entry) => [entry.trackId, 'Not played in a while']),
      ),
    ),
    mix(
      'deep-cuts',
      'Deep cuts',
      'More from your top artists',
      deepCuts.map((entry) => entry.trackId),
      Object.fromEntries(
        deepCuts.map((entry) => [entry.trackId, 'More from your top artists']),
      ),
    ),
    mix(
      'favorites-radio',
      'Favorites radio',
      'One tap, already familiar',
      favoriteTracks.map((track) => track.id),
      Object.fromEntries(favoriteTracks.map((track) => [track.id, 'In your favorites'])),
    ),
  ].filter((entry): entry is CarMix => entry !== null);

  return {
    version: CAR_RECOMMENDATION_VERSION,
    generatedAt: new Date(now).toISOString(),
    mixes,
  };
}
