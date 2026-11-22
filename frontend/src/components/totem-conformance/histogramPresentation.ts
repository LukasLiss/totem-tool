import type { HistogramCounts } from "@/api/totemConformanceApi";

import type { ConformanceDimension } from "./conformanceLookup";

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

function finiteCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

const HISTOGRAM_SHORT_LABELS: Record<string, string> = {
  D: "D",
  Di: "D-i",
  I: "I",
  Ii: "I-i",
  P: "P",
};

export interface HistogramTableColumn {
  key: string;
  /** Compact header text, e.g. "D-i". */
  label: string;
  /** Full name, used as the header tooltip. */
  title: string;
}

export interface HistogramTableRow {
  label: string;
  total: number;
  counts: Record<string, number>;
}

export interface HistogramTable {
  columns: HistogramTableColumn[];
  rows: HistogramTableRow[];
  sum: HistogramTableRow;
}

/**
 * Lays several histograms out as one table: one row per record (an activity
 * or a relation type), one column per histogram value, plus a summed row.
 * Values beyond the known ones become extra columns, so nothing is dropped.
 */
export function createHistogramTable(
  records: readonly { label: string; counts: HistogramCounts }[],
  dimension: ConformanceDimension
): HistogramTable {
  const knownKeys: readonly string[] =
    dimension === "temporal" ? TEMPORAL_KEYS : CARDINALITY_KEYS;
  const extraKeys = [
    ...new Set(
      records.flatMap((record) =>
        Object.keys(record.counts).filter(
          (key) => key !== "total" && !knownKeys.includes(key)
        )
      )
    ),
  ].sort((left, right) => left.localeCompare(right));
  const keys = [...knownKeys, ...extraKeys];

  const rows = records.map((record) => {
    const counts = Object.fromEntries(
      keys.map((key) => [key, finiteCount(record.counts[key])])
    );
    const declaredTotal = finiteCount(record.counts.total);
    return {
      label: record.label,
      counts,
      total:
        declaredTotal > 0
          ? declaredTotal
          : keys.reduce((sum, key) => sum + counts[key], 0),
    };
  });

  return {
    columns: keys.map((key) => ({
      key,
      label: HISTOGRAM_SHORT_LABELS[key] ?? key,
      title: HISTOGRAM_LABELS[key] ?? key,
    })),
    rows,
    sum: {
      label: "Sum",
      total: rows.reduce((sum, row) => sum + row.total, 0),
      counts: Object.fromEntries(
        keys.map((key) => [
          key,
          rows.reduce((sum, row) => sum + row.counts[key], 0),
        ])
      ),
    },
  };
}

/** Share of a row's total, as a whole percentage ("43%"); "-" without a total. */
export function formatHistogramShare(count: number, total: number): string {
  if (total <= 0) return "-";
  return `${Math.round((count / total) * 100)}%`;
}
