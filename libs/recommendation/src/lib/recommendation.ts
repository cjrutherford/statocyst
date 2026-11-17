import type { Track } from '@statocyst/contracts';
import { radioScore } from '@statocyst/playback-core';
import type { PlayedTrack } from './recent-tracks';

/** How strongly each positive signal can move a candidate. */
const FAVORITE = 25;
const ARTIST_AFFINITY = 30;
const GENRE_AFFINITY = 18;
const ALBUM_AFFINITY = 8;
const SEED_SIMILARITY = 20;
const DISCOVERY = 4;
const REDISCOVER = 6;
const RECENT_WINDOW_PENALTY = 22;
const RECENT_WEEK_PENALTY = 10;
/** A song just heard belongs in Recently played, not at the top of the mix. */
const RECENT_EXCLUSION_DAYS = 0.5;
const MAX_PER_ARTIST = 2;
const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 12;

export type RecommendationReasonCode =
  | 'favorite'
  | 'artist-affinity'
  | 'genre-affinity'
  | 'album-affinity'
  | 'seed-similarity'
  | 'rediscover'
  | 'discovery';

/** A ranked candidate plus the observable signals that produced its position. */
export interface RecommendationReason {
  code: RecommendationReasonCode;
  /** Plain-language explanation suitable for a row or tooltip. */
  label: string;
  /** Contribution to the score; larger means a stronger signal. */
  weight: number;
}

export interface Recommendation {
  trackId: string;
  score: number;
  confidence: 'low' | 'medium' | 'high';
  /** Strongest explanations first. Never empty. */
  reasons: RecommendationReason[];
}

export interface RecommendationInput {
  tracks: readonly Track[];
  /** Explicit favorites, by canonical track id. */
  favorites?: ReadonlySet<string>;
  /** Newest-first local listening history. */
  recent?: readonly PlayedTrack[];
  limit?: number;
  /** Tracks already queued or otherwise unwanted. */
  excludeTrackIds?: ReadonlySet<string>;
  /**
   * Songs the user picked as the basis of this mix. When omitted, the newest
   * recent plays act as implicit seeds.
   */
  seedTrackIds?: readonly string[];
  /** Clock injection so a mix is reproducible in tests. */
  now?: number;
}

interface AffinityProfile {
  artist: Map<string, number>;
  genre: Map<string, number>;
  album: Map<string, number>;
}

const norm = (value: string | null | undefined): string =>
  (value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const genresOf = (track: Track): Array<{ key: string; label: string }> =>
  (track.genre ?? '')
    .split(/[,;/|]/)
    .map((genre) => ({ key: norm(genre), label: genre.trim() }))
    .filter((genre) => genre.key.length > 0);

function add(map: Map<string, number>, key: string, amount: number): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

function normalized(map: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const value of map.values()) max = Math.max(max, value);
  if (max <= 0) return new Map();
  const result = new Map<string, number>();
  for (const [key, value] of map) result.set(key, value / max);
  return result;
}

function recencyWeight(playedAt: string, now: number): number {
  const at = Date.parse(playedAt);
  if (!Number.isFinite(at)) return 0;
  const days = Math.max(0, (now - at) / DAY_MS);
  if (days <= 7) return 1;
  if (days <= 30) return 0.65;
  if (days <= 90) return 0.35;
  return 0.15;
}

function daysSince(playedAt: string, now: number): number | null {
  const at = Date.parse(playedAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, (now - at) / DAY_MS);
}

/** Deterministic 0..3 so equal scores vary by seed but stay reproducible. */
function jitter(seed: string, id: string): number {
  let hash = 0;
  const text = `${seed}|${id}`;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 4;
}

function behaviorProfile(
  tracksById: ReadonlyMap<string, Track>,
  favorites: ReadonlySet<string>,
  recent: readonly PlayedTrack[],
  now: number,
): AffinityProfile {
  const profile: AffinityProfile = {
    artist: new Map(),
    genre: new Map(),
    album: new Map(),
  };

  for (const id of favorites) {
    const track = tracksById.get(id);
    if (!track || track.missing) continue;
    add(profile.artist, norm(track.artist), 2.5);
    for (const genre of genresOf(track)) add(profile.genre, genre.key, 1.5);
    add(profile.album, norm(track.album), 0.3);
  }

  for (const entry of recent) {
    const track = entry.track;
    if (track.missing) continue;
    const weight =
      recencyWeight(entry.playedAt, now) *
      (1 + Math.min(1, Math.log1p(entry.playCount) / 4));
    add(profile.artist, norm(track.artist), weight);
    for (const genre of genresOf(track)) add(profile.genre, genre.key, weight * 0.8);
    add(profile.album, norm(track.album), weight * 0.4);
  }

  return profile;
}

function bestSharedGenre(
  track: Track,
  genreAffinity: ReadonlyMap<string, number>,
): { label: string; weight: number } | null {
  let best: { label: string; weight: number } | null = null;
  for (const genre of genresOf(track)) {
    const weight = genreAffinity.get(genre.key) ?? 0;
    if (weight > 0 && (!best || weight > best.weight)) {
      best = { label: genre.label, weight };
    }
  }
  return best;
}

function similarityToSeeds(
  track: Track,
  seeds: readonly Track[],
): { seed: Track; weight: number } | null {
  let best: { seed: Track; weight: number } | null = null;
  for (const seed of seeds) {
    if (seed.id === track.id) continue;
    // Favorites are a separate signal, so similarity stays metadata-only.
    const weight = radioScore(seed, track, false) / 80;
    if (weight > 0 && (!best || weight > best.weight)) best = { seed, weight };
  }
  return best;
}

function confidenceOf(score: number, reasons: readonly RecommendationReason[]): Recommendation['confidence'] {
  const strong = reasons.filter((reason) => reason.weight >= 10).length;
  if (score >= 40 && strong >= 2) return 'high';
  if (score >= 18) return 'medium';
  return 'low';
}

/**
 * A local, explainable first slice of the Statolith recommender. It combines
 * three observable signals already on the device — explicit favorites,
 * listening history and metadata similarity — and returns the reasons for each
 * position. It sends nothing off the device and never invents acoustic data.
 *
 * Full vector embeddings and acoustic features remain deferred (ADR-005); this
 * function intentionally stays deterministic and cheap enough for a renderer.
 */
export function recommendTracks(input: RecommendationInput): Recommendation[] {
  const now = input.now ?? Date.now();
  const limit = Math.max(0, Math.floor(input.limit ?? DEFAULT_LIMIT));
  if (limit === 0) return [];

  const favorites = input.favorites ?? new Set<string>();
  const recent = input.recent ?? [];
  const excluded = input.excludeTrackIds ?? new Set<string>();
  const tracksById = new Map<string, Track>();
  for (const track of input.tracks) {
    if (!track.missing) tracksById.set(track.id, track);
  }

  const explicitSeeds = (input.seedTrackIds ?? [])
    .map((id) => tracksById.get(id))
    .filter((track): track is Track => !!track);
  const seeds = explicitSeeds.length > 0
    ? explicitSeeds
    : recent
        .map((entry) => tracksById.get(entry.track.id))
        .filter((track): track is Track => !!track)
        .slice(0, 3);
  const seedIds = new Set(seeds.map((seed) => seed.id));
  const excludeSeeds = explicitSeeds.length > 0;

  const profile = behaviorProfile(tracksById, favorites, recent, now);
  const artistAffinity = normalized(profile.artist);
  const genreAffinity = normalized(profile.genre);
  const albumAffinity = normalized(profile.album);
  const signature = seeds.length > 0 ? seeds.map((seed) => seed.id).sort().join('|') : 'library';

  const ranked: Array<{ track: Track; recommendation: Recommendation }> = [];

  for (const track of tracksById.values()) {
    if (excluded.has(track.id)) continue;
    if (excludeSeeds && seedIds.has(track.id)) continue;

    let score = 0;
    const reasons: RecommendationReason[] = [];
    const favorite = favorites.has(track.id);
    const playedAt = typeof track.lastPlayedAt === 'string' ? track.lastPlayedAt : null;
    const days = playedAt ? daysSince(playedAt, now) : null;
    if (days !== null && days < RECENT_EXCLUSION_DAYS) continue;

    if (favorite) {
      score += FAVORITE;
      reasons.push({ code: 'favorite', label: 'In your favorites', weight: FAVORITE });
    }

    const artistWeight = artistAffinity.get(norm(track.artist)) ?? 0;
    if (artistWeight > 0) {
      const weight = artistWeight * ARTIST_AFFINITY;
      score += weight;
      reasons.push({
        code: 'artist-affinity',
        label: `More from ${track.artist || 'an artist you play'}`,
        weight,
      });
    }

    const genre = bestSharedGenre(track, genreAffinity);
    if (genre) {
      const weight = genre.weight * GENRE_AFFINITY;
      score += weight;
      reasons.push({
        code: 'genre-affinity',
        label: `Matches your ${genre.label} listening`,
        weight,
      });
    }

    const albumWeight = albumAffinity.get(norm(track.album)) ?? 0;
    if (albumWeight > 0) {
      const weight = albumWeight * ALBUM_AFFINITY;
      score += weight;
      reasons.push({
        code: 'album-affinity',
        label: `From ${track.album || 'an album you play'}`,
        weight,
      });
    }

    const similar = similarityToSeeds(track, seeds);
    if (similar) {
      const weight = Math.min(1, similar.weight) * SEED_SIMILARITY;
      score += weight;
      reasons.push({
        code: 'seed-similarity',
        label: explicitSeeds.length > 0
          ? `Similar to ${similar.seed.title}`
          : 'Similar to songs you played recently',
        weight,
      });
    }

    if (days !== null) {
      if (days <= 2) score -= RECENT_WINDOW_PENALTY;
      else if (days <= 7) score -= RECENT_WEEK_PENALTY;
      else if (days > 30) {
        score += REDISCOVER;
        reasons.push({
          code: 'rediscover',
          label: favorite ? 'A favorite you have not played lately' : 'Not played in a while',
          weight: REDISCOVER,
        });
      }
    } else if (favorite) {
      score += REDISCOVER;
      reasons.push({
        code: 'rediscover',
        label: 'A favorite you have not played yet',
        weight: REDISCOVER,
      });
    } else {
      score += DISCOVERY;
      reasons.push({ code: 'discovery', label: 'New to you', weight: DISCOVERY });
    }

    score += jitter(signature, track.id);
    const orderedReasons = reasons.sort((a, b) => b.weight - a.weight).slice(0, 2);
    if (orderedReasons.length === 0) {
      orderedReasons.push({ code: 'discovery', label: 'A fresh pick from your library', weight: 0 });
    }

    ranked.push({
      track,
      recommendation: {
        trackId: track.id,
        score: Math.round(score * 10) / 10,
        confidence: confidenceOf(score, orderedReasons),
        reasons: orderedReasons,
      },
    });
  }

  ranked.sort(
    (a, b) =>
      b.recommendation.score - a.recommendation.score ||
      a.track.id.localeCompare(b.track.id),
  );

  // Spread the mix across artists, then use the deferred rows only if the
  // library is too concentrated to fill the requested length.
  const picked: typeof ranked = [];
  const deferred: typeof ranked = [];
  const perArtist = new Map<string, number>();
  for (const entry of ranked) {
    const artist = norm(entry.track.artist);
    const count = perArtist.get(artist) ?? 0;
    if (artist && count >= MAX_PER_ARTIST) {
      deferred.push(entry);
      continue;
    }
    picked.push(entry);
    if (artist) perArtist.set(artist, count + 1);
    if (picked.length === limit) break;
  }
  if (picked.length < limit) {
    for (const entry of deferred) {
      picked.push(entry);
      if (picked.length === limit) break;
    }
  }

  return picked.map((entry) => entry.recommendation);
}
