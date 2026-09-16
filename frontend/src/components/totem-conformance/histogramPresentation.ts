import type { HistogramCounts } from "@/api/totemConformanceApi";

import type { ConformanceDimension } from "./conformanceLookup";

export interface HistogramRow {
  key: string;
  label: string;
  count: number;
  ratio: number;
}

const TEMPORAL_KEYS = ["D", "Di", "I", "Ii", "P"] as const;
const CARDINALITY_KEYS = ["0", "1", "0...1", "1..*", "0...*"] as const;

const HISTOGRAM_LABELS: Record<string, string> = {
  D: "Dependent",
  Di: "Dependent inverse",
  I: "Initiating",
  Ii: "Initiating inverse",
  P: "Parallel",
  "0": "Zero",
  "1": "One",
  "0...1": "Zero or one",
  "1..*": "One or more",
  "0...*": "Zero or more",
};

export function createHistogramRows(
  counts: HistogramCounts,
  dimension: ConformanceDimension
): HistogramRow[] {
  const knownKeys =
    dimension === "temporal" ? TEMPORAL_KEYS : CARDINALITY_KEYS;
  const extraKeys = Object.keys(counts)
    .filter((key) => key !== "total" && !knownKeys.includes(key as never))
    .sort((left, right) => left.localeCompare(right));
  const keys = [...knownKeys, ...extraKeys];
  const declaredTotal = finiteCount(counts.total);
  const total =
    declaredTotal > 0
      ? declaredTotal
      : keys.reduce((sum, key) => sum + finiteCount(counts[key]), 0);

  return keys.map((key) => {
    const count = finiteCount(counts[key]);
    return {
      key,
      label: HISTOGRAM_LABELS[key] ?? key,
      count,
      ratio: total > 0 ? Math.min(count / total, 1) : 0,
    };
  });
}

function finiteCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}
