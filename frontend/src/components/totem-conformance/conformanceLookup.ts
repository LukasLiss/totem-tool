import type {
  ActivityHistogram,
  PairHistogram,
  RelationTypeHistogram,
  TotemConformanceResponse,
  TypePairConformance,
} from "@/api/totemConformanceApi";

import { directionalPairKey } from "./visualizationModel";

export const CONFORMANCE_DIMENSIONS = [
  "temporal",
  "log_cardinality",
  "event_cardinality",
] as const;

export type ConformanceDimension = (typeof CONFORMANCE_DIMENSIONS)[number];

export interface TotemConformanceLookup {
  typePairs: ReadonlyMap<string, TypePairConformance>;
  pairHistograms: Record<
    ConformanceDimension,
    ReadonlyMap<string, PairHistogram>
  >;
  eventCardinalityByActivity: ReadonlyMap<string, readonly ActivityHistogram[]>;
  temporalByRelationType: ReadonlyMap<
    string,
    readonly RelationTypeHistogram[]
  >;
  logCardinalityByRelationType: ReadonlyMap<
    string,
    readonly RelationTypeHistogram[]
  >;
}

export interface DirectionalTypePairMetrics {
  forward: TypePairConformance | null;
  reverse: TypePairConformance | null;
}

/** Build tuple-safe, directed indexes for the array-based conformance response. */
export function createTotemConformanceLookup(
  response: TotemConformanceResponse
): TotemConformanceLookup {
  return {
    typePairs: indexByPair(response.type_pair_metrics),
    pairHistograms: {
      temporal: indexByPair(response.histograms.temporal),
      log_cardinality: indexByPair(response.histograms.log_cardinality),
      event_cardinality: indexByPair(response.histograms.event_cardinality),
    },
    eventCardinalityByActivity: groupByPair(
      response.histograms.event_cardinality_by_activity
    ),
    temporalByRelationType: groupByPair(
      response.histograms.temporal_by_relation_type
    ),
    logCardinalityByRelationType: groupByPair(
      response.histograms.log_cardinality_by_relation_type
    ),
  };
}

export function getDirectionalTypePairMetrics(
  lookup: TotemConformanceLookup,
  source: string,
  target: string
): DirectionalTypePairMetrics {
  return {
    forward: lookup.typePairs.get(directionalPairKey(source, target)) ?? null,
    reverse: lookup.typePairs.get(directionalPairKey(target, source)) ?? null,
  };
}

export function getPairHistogram(
  lookup: TotemConformanceLookup,
  dimension: ConformanceDimension,
  source: string,
  target: string
): PairHistogram | null {
  return (
    lookup.pairHistograms[dimension].get(
      directionalPairKey(source, target)
    ) ?? null
  );
}

export function getActivityHistograms(
  lookup: TotemConformanceLookup,
  source: string,
  target: string
): readonly ActivityHistogram[] {
  return (
    lookup.eventCardinalityByActivity.get(
      directionalPairKey(source, target)
    ) ?? []
  );
}

export function getRelationTypeHistograms(
  lookup: TotemConformanceLookup,
  dimension: "temporal" | "log_cardinality",
  source: string,
  target: string
): readonly RelationTypeHistogram[] {
  const collection =
    dimension === "temporal"
      ? lookup.temporalByRelationType
      : lookup.logCardinalityByRelationType;
  return collection.get(directionalPairKey(source, target)) ?? [];
}

function indexByPair<T extends { source_type: string; target_type: string }>(
  records: readonly T[]
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const record of records) {
    const key = directionalPairKey(record.source_type, record.target_type);
    if (!result.has(key)) result.set(key, record);
  }
  return result;
}

function groupByPair<T extends { source_type: string; target_type: string }>(
  records: readonly T[]
): ReadonlyMap<string, readonly T[]> {
  const result = new Map<string, T[]>();
  for (const record of records) {
    const key = directionalPairKey(record.source_type, record.target_type);
    const grouped = result.get(key);
    if (grouped) grouped.push(record);
    else result.set(key, [record]);
  }
  return result;
}
