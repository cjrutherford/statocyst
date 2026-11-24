export interface SearchableEntity {
  identity: string;
  primary: string;
  secondary?: readonly string[];
}

/** Search score: exact, prefix, then substring; primary fields precede secondary fields. */
export function rankSearchEntity(query: string, entity: SearchableEntity): number | null {
  const term = normalize(query);
  if (!term) return null;
  const primaryScore = bestFieldScore(term, [entity.primary]);
  if (primaryScore !== null) return primaryScore;
  const secondaryScore = bestFieldScore(term, entity.secondary ?? []);
  return secondaryScore === null ? null : secondaryScore + 3;
}

export function rankAndSortSearchEntities<T extends SearchableEntity>(
  query: string,
  entities: readonly T[],
): T[] {
  return entities
    .map((entity) => ({ entity, score: rankSearchEntity(query, entity) }))
    .filter((row): row is { entity: T; score: number } => row.score !== null)
    .sort(
      (a, b) =>
        a.score - b.score ||
        compare(normalize(a.entity.identity), normalize(b.entity.identity)) ||
        compare(a.entity.identity, b.entity.identity),
    )
    .map(({ entity }) => entity);
}

function bestFieldScore(term: string, fields: readonly string[]): number | null {
  let best: number | null = null;
  for (const field of fields) {
    const value = normalize(field);
    const score = value === term ? 0 : value.startsWith(term) ? 1 : value.includes(term) ? 2 : null;
    if (score !== null && (best === null || score < best)) best = score;
  }
  return best;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
