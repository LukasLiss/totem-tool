import axios from "axios";

export interface FitnessPrecision {
  fitness: number | null;
  precision: number | null;
}

export interface AverageFitnessPrecision {
  avg_fitness: number | null;
  avg_precision: number | null;
}

export interface RelationConformance extends FitnessPrecision {
  model_relation: string | null;
}

export interface ObjectTypeConformance {
  temporal: AverageFitnessPrecision;
  log_cardinality: AverageFitnessPrecision;
  event_cardinality: AverageFitnessPrecision;
}

export interface TypePairConformance {
  source_type: string;
  target_type: string;
  temporal: RelationConformance;
  log_cardinality: RelationConformance;
  event_cardinality: RelationConformance;
}

export type HistogramCounts = Record<string, number>;

export interface PairHistogram {
  source_type: string;
  target_type: string;
  counts: HistogramCounts;
}

export interface ActivityHistogram extends PairHistogram {
  activity: string;
}

export interface RelationTypeHistogram extends PairHistogram {
  relation_type: string;
}

export interface TotemConformanceHistograms {
  temporal: PairHistogram[];
  log_cardinality: PairHistogram[];
  event_cardinality: PairHistogram[];
  event_cardinality_by_activity: ActivityHistogram[];
  temporal_by_relation_type: RelationTypeHistogram[];
  log_cardinality_by_relation_type: RelationTypeHistogram[];
}

export interface TotemConformanceResponse {
  file_id: number;
  asset_id: number;
  overall_metrics: {
    temporal: FitnessPrecision;
    log_cardinality: FitnessPrecision;
    event_cardinality: FitnessPrecision;
  };
  object_type_metrics: Record<string, ObjectTypeConformance>;
  type_pair_metrics: TypePairConformance[];
  histograms: TotemConformanceHistograms;
}

const FILES_URL = "/api/files/";

export async function runTotemConformance(
  eventLogId: number,
  assetId: number
): Promise<TotemConformanceResponse> {
  const { data } = await axios.post<TotemConformanceResponse>(
    `${FILES_URL}${eventLogId}/totem_conformance/`,
    { asset_id: assetId }
  );
  return data;
}
