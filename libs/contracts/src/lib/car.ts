/**
 * The recommendation snapshot the phone publishes to native car surfaces.
 *
 * Android Auto, CarPlay and Android Automotive OS have no WebView, so they read
 * this small, versioned snapshot instead of running the TypeScript recommender.
 * Track ids are resolved against the local catalog; reasons are short labels
 * suitable for a car row.
 */
export const CAR_RECOMMENDATION_VERSION = 1 as const;

export interface CarMix {
  /** Stable id, for example `daily-drift` or `rediscover`. */
  id: string;
  title: string;
  subtitle: string;
  trackIds: string[];
  /** Track id -> one short explanation shown by the car UI. */
  reasons: Record<string, string>;
}

export interface CarRecommendationSnapshot {
  version: typeof CAR_RECOMMENDATION_VERSION;
  /** ISO timestamp of the ranking that produced this snapshot. */
  generatedAt: string;
  /** Ordered mixes. The first mix is the default "For you" list. */
  mixes: CarMix[];
}
