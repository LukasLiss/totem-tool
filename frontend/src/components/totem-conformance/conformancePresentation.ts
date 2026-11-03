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

/**
 * The value a single notation element is coloured by: the lower of its
 * fitness and precision, so an element is flagged when either is weak.
 */
export function getConformanceScore(
  metrics: { fitness: number | null; precision: number | null } | null | undefined
): number | null {
  const values = [metrics?.fitness, metrics?.precision].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  return values.length > 0 ? Math.min(...values) : null;
}

export interface DirectionalElementColors {
  temporal: string;
  log: string;
  event: string;
}

/**
 * Colours of every element of one relation, per reading direction.
 *
 * `target` describes source → target and `source` target → source, matching
 * the end of the line at which TotemRelationEdge draws those elements.
 */
export function getRelationElementColors(
  lookup: TotemConformanceLookup,
  source: string,
  target: string
): { source: DirectionalElementColors; target: DirectionalElementColors } {
  const metrics = getDirectionalTypePairMetrics(lookup, source, target);
  const colorsOf = (pair: typeof metrics.forward): DirectionalElementColors => ({
    temporal: getFitnessColor(getConformanceScore(pair?.temporal)),
    log: getFitnessColor(getConformanceScore(pair?.log_cardinality)),
    event: getFitnessColor(getConformanceScore(pair?.event_cardinality)),
  });
  return { source: colorsOf(metrics.reverse), target: colorsOf(metrics.forward) };
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
