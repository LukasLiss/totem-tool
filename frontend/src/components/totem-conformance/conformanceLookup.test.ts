import { describe, expect, it } from "vitest";

import type { TotemConformanceResponse } from "@/api/totemConformanceApi";

import {
  createTotemConformanceLookup,
  getActivityHistograms,
  getDirectionalTypePairMetrics,
  getPairHistogram,
  getRelationTypeHistograms,
} from "./conformanceLookup";

const pair = (
  sourceType: string,
  targetType: string,
  fitness: number | null
) => ({
  source_type: sourceType,
  target_type: targetType,
  temporal: { model_relation: "D", fitness, precision: 0.8 },
  log_cardinality: { model_relation: "1", fitness: 0.7, precision: 0.6 },
  event_cardinality: { model_relation: "0...*", fitness: 0.5, precision: 0.4 },
});

const response: TotemConformanceResponse = {
  file_id: 12,
  asset_id: 4,
  overall_metrics: {
    temporal: { fitness: 0.9, precision: 0.8 },
    log_cardinality: { fitness: 0.7, precision: 0.6 },
    event_cardinality: { fitness: 0.5, precision: 0.4 },
  },
  object_type_metrics: {},
  type_pair_metrics: [
    pair("Order|EU", "Item", 0.9),
    pair("Item", "Order|EU", null),
    pair("Order", "EU|Item", 0.3),
  ],
  histograms: {
    temporal: [
      { source_type: "Order|EU", target_type: "Item", counts: { D: 4 } },
    ],
    log_cardinality: [],
    event_cardinality: [],
    event_cardinality_by_activity: [
      {
        source_type: "Order|EU",
        target_type: "Item",
        activity: "Pick",
        counts: { "0...*": 3 },
      },
    ],
    temporal_by_relation_type: [
      {
        source_type: "Order|EU",
        target_type: "Item",
        relation_type: "D",
        counts: { D: 4 },
      },
    ],
    log_cardinality_by_relation_type: [],
  },
};

describe("TOTeM conformance lookup adapter", () => {
  it("keeps forward and reverse metrics distinct", () => {
    const lookup = createTotemConformanceLookup(response);
    const metrics = getDirectionalTypePairMetrics(lookup, "Order|EU", "Item");

    expect(metrics.forward?.temporal.fitness).toBe(0.9);
    expect(metrics.reverse?.temporal.fitness).toBeNull();
  });

  it("uses tuple-safe keys for object type names containing delimiters", () => {
    const lookup = createTotemConformanceLookup(response);

    expect(
      getDirectionalTypePairMetrics(lookup, "Order", "EU|Item").forward?.temporal
        .fitness
    ).toBe(0.3);
    expect(
      getDirectionalTypePairMetrics(lookup, "Order|EU", "Item").forward?.temporal
        .fitness
    ).toBe(0.9);
  });

  it("indexes aggregate and detailed histograms by direction", () => {
    const lookup = createTotemConformanceLookup(response);

    expect(
      getPairHistogram(lookup, "temporal", "Order|EU", "Item")?.counts
    ).toEqual({ D: 4 });
    expect(getActivityHistograms(lookup, "Order|EU", "Item")).toHaveLength(1);
    expect(
      getRelationTypeHistograms(
        lookup,
        "temporal",
        "Order|EU",
        "Item"
      )
    ).toHaveLength(1);
    expect(getPairHistogram(lookup, "temporal", "Item", "Order|EU")).toBeNull();
  });
});
