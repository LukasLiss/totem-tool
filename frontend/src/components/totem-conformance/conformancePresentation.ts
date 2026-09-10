import type { FitnessPrecision } from "@/api/totemConformanceApi";

import {
  getDirectionalTypePairMetrics,
  type ConformanceDimension,
  type TotemConformanceLookup,
} from "./conformanceLookup";

export interface ConformanceDimensionDefinition {
  id: ConformanceDimension;
  label: string;
  shortLabel: string;
}

export interface FitnessBand {
  id: "poor" | "moderate" | "strong" | "unavailable";
  label: string;
  color: string;
}

export const CONFORMANCE_DIMENSION_DEFINITIONS: readonly ConformanceDimensionDefinition[] = [
  { id: "temporal", label: "Temporal", shortLabel: "Temporal" },
  {
    id: "log_cardinality",
    label: "Log cardinality",
    shortLabel: "Log card.",
  },
  {
    id: "event_cardinality",
    label: "Event cardinality",
    shortLabel: "Event card.",
  },
];

export const FITNESS_BANDS: readonly FitnessBand[] = [
  { id: "poor", label: "< 0.75", color: "#DC2626" },
  { id: "moderate", label: "0.75-0.89", color: "#D97706" },
  { id: "strong", label: ">= 0.90", color: "#16A34A" },
  { id: "unavailable", label: "No data", color: "#94A3B8" },
];

export function getDimensionDefinition(
  dimension: ConformanceDimension
): ConformanceDimensionDefinition {
  return (
    CONFORMANCE_DIMENSION_DEFINITIONS.find(({ id }) => id === dimension) ??
    CONFORMANCE_DIMENSION_DEFINITIONS[0]
  );
}

export function getDimensionMetrics(
  overallMetrics: {
    temporal: FitnessPrecision;
    log_cardinality: FitnessPrecision;
    event_cardinality: FitnessPrecision;
  },
  dimension: ConformanceDimension
): FitnessPrecision {
  return overallMetrics[dimension];
}

/** Use the weaker available direction so pair-level deviations remain visible. */
export function getPairFitness(
  lookup: TotemConformanceLookup,
  source: string,
  target: string,
  dimension: ConformanceDimension
): number | null {
  const metrics = getDirectionalTypePairMetrics(lookup, source, target);
  const values = [
    metrics.forward?.[dimension].fitness,
    metrics.reverse?.[dimension].fitness,
  ].filter((value): value is number => typeof value === "number");
  return values.length > 0 ? Math.min(...values) : null;
}

export function getFitnessBand(value: number | null | undefined): FitnessBand {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return FITNESS_BANDS[3];
  }
  if (value < 0.75) return FITNESS_BANDS[0];
  if (value < 0.9) return FITNESS_BANDS[1];
  return FITNESS_BANDS[2];
}

export function getFitnessColor(value: number | null | undefined): string {
  return getFitnessBand(value).color;
}

export function formatConformanceMetric(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2)
    : "-";
}
