/** Per-arc relation statistics the process-area endpoints return. */

export type RelationFamily = 'temporal' | 'event_cardinality' | 'log_cardinality';

/** One direction of a connected object-type pair, as the backend sends it. */
export type RelationStats = {
  from: string;
  to: string;
  /** Histogram counts per family; `total` is the number of related pairs. */
  counts: Record<RelationFamily, Record<string, number>>;
  /** The value each family takes at tau = 100%. */
  strict: Record<RelationFamily, string>;
};

export type RelationStatsIndex = Map<string, RelationStats>;

export const relationStatsKey = (from: string, to: string) => `${from}\u0000${to}`;

export function indexRelationStats(stats: RelationStats[] | undefined): RelationStatsIndex {
  const index: RelationStatsIndex = new Map();
  (stats ?? []).forEach((entry) => index.set(relationStatsKey(entry.from, entry.to), entry));
  return index;
}
