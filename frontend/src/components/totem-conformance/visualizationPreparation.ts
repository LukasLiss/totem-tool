import type { ProjectAsset } from "@/api/assetsApi";
import type {
  AverageFitnessPrecision,
  FitnessPrecision,
  RelationConformance,
  TotemConformanceResponse,
} from "@/api/totemConformanceApi";

import {
  createTotemVisualizationModel,
  TotemVisualizationModelError,
  type TotemVisualizationModel,
} from "./visualizationModel";

export type TotemVisualizationPreparation =
  | { status: "ready"; model: TotemVisualizationModel }
  | {
      status: "unavailable" | "invalid" | "empty";
      title: string;
      description: string;
    };

/** Prepare API and asset-store data before either reaches the graph renderer. */
export function prepareTotemVisualization(
  asset: ProjectAsset | null,
  result: TotemConformanceResponse,
  eventLogId: number
): TotemVisualizationPreparation {
  if (!asset) {
    return {
      status: "unavailable",
      title: "Selected model unavailable",
      description: "The model used for this result is no longer available in the project.",
    };
  }

  if (result.asset_id !== asset.id || result.file_id !== eventLogId) {
    return {
      status: "unavailable",
      title: "Result context changed",
      description: "Run conformance again for the currently selected event log and model.",
    };
  }

  if (!isValidConformanceResponse(result)) {
    return {
      status: "invalid",
      title: "Conformance result cannot be displayed",
      description: "The calculation returned an unsupported or incomplete result.",
    };
  }

  let model: TotemVisualizationModel;
  try {
    model = createTotemVisualizationModel(asset.content_json);
  } catch (error) {
    return {
      status: "invalid",
      title: "TOTeM model cannot be displayed",
      description:
        error instanceof TotemVisualizationModelError
          ? error.message
          : "The stored model does not match the supported TOTeM format.",
    };
  }

  if (model.nodes.length === 0) {
    return {
      status: "empty",
      title: "TOTeM model is empty",
      description: "The selected model does not contain any object types to display.",
    };
  }

  if (!hasConformanceData(result)) {
    return {
      status: "empty",
      title: "No conformance data returned",
      description: "The calculation completed without metrics that can be displayed.",
    };
  }

  return { status: "ready", model };
}

function isValidConformanceResponse(value: unknown): value is TotemConformanceResponse {
  if (!isRecord(value)) return false;
  if (!isPositiveInteger(value.file_id) || !isPositiveInteger(value.asset_id)) {
    return false;
  }
  if (!isOverallMetrics(value.overall_metrics)) return false;
  if (!isRecord(value.object_type_metrics)) return false;
  if (!Object.values(value.object_type_metrics).every(isObjectTypeMetrics)) {
    return false;
  }
  if (
    !Array.isArray(value.type_pair_metrics) ||
    !value.type_pair_metrics.every(isTypePairMetrics)
  ) {
    return false;
  }
  if (!isRecord(value.histograms)) return false;

  const histograms = value.histograms;
  return (
    isRecordArray(histograms.temporal, isPairHistogram) &&
    isRecordArray(histograms.log_cardinality, isPairHistogram) &&
    isRecordArray(histograms.event_cardinality, isPairHistogram) &&
    isRecordArray(histograms.event_cardinality_by_activity, (record) =>
      isPairHistogram(record) && typeof record.activity === "string"
    ) &&
    isRecordArray(histograms.temporal_by_relation_type, (record) =>
      isPairHistogram(record) && typeof record.relation_type === "string"
    ) &&
    isRecordArray(histograms.log_cardinality_by_relation_type, (record) =>
      isPairHistogram(record) && typeof record.relation_type === "string"
    )
  );
}

function isOverallMetrics(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ["temporal", "log_cardinality", "event_cardinality"].every((key) =>
    isFitnessPrecision(value[key])
  );
}

function isFitnessPrecision(value: unknown): value is FitnessPrecision {
  return (
    isRecord(value) &&
    isNullableFiniteNumber(value.fitness) &&
    isNullableFiniteNumber(value.precision)
  );
}

function isAverageFitnessPrecision(
  value: unknown
): value is AverageFitnessPrecision {
  return (
    isRecord(value) &&
    isNullableFiniteNumber(value.avg_fitness) &&
    isNullableFiniteNumber(value.avg_precision)
  );
}

function isRelationConformance(value: unknown): value is RelationConformance {
  return (
    isRecord(value) &&
    isFitnessPrecision(value) &&
    (value.model_relation === null || typeof value.model_relation === "string")
  );
}

function isObjectTypeMetrics(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ["temporal", "log_cardinality", "event_cardinality"].every((key) =>
    isAverageFitnessPrecision(value[key])
  );
}

function isTypePairMetrics(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.source_type === "string" &&
    typeof value.target_type === "string" &&
    ["temporal", "log_cardinality", "event_cardinality"].every((key) =>
      isRelationConformance(value[key])
    )
  );
}

function isPairHistogram(value: Record<string, unknown>): boolean {
  return (
    typeof value.source_type === "string" &&
    typeof value.target_type === "string" &&
    isRecord(value.counts) &&
    Object.values(value.counts).every(
      (count) => typeof count === "number" && Number.isFinite(count) && count >= 0
    )
  );
}

function isRecordArray(
  value: unknown,
  predicate: (record: Record<string, unknown>) => boolean
): boolean {
  return Array.isArray(value) && value.every((record) => isRecord(record) && predicate(record));
}

function hasConformanceData(result: TotemConformanceResponse): boolean {
  const overallValues = Object.values(result.overall_metrics).flatMap((metrics) => [
    metrics.fitness,
    metrics.precision,
  ]);
  if (overallValues.some((value) => typeof value === "number")) return true;
  const objectTypeValues = Object.values(result.object_type_metrics).flatMap(
    (metrics) =>
      Object.values(metrics).flatMap((dimension) => [
        dimension.avg_fitness,
        dimension.avg_precision,
      ])
  );
  if (objectTypeValues.some((value) => typeof value === "number")) return true;
  const pairValues = result.type_pair_metrics.flatMap((metrics) =>
    [metrics.temporal, metrics.log_cardinality, metrics.event_cardinality].flatMap(
      (dimension) => [dimension.fitness, dimension.precision]
    )
  );
  if (pairValues.some((value) => typeof value === "number")) return true;
  return Object.values(result.histograms).some((records) => records.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}
