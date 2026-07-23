import { describe, expect, it } from "vitest";

import type { TotemConformanceResponse } from "@/api/totemConformanceApi";

import { createTotemConformanceLookup } from "./conformanceLookup";
import {
  formatConformanceMetric,
  getFitnessBand,
  getPairFitness,
} from "./conformancePresentation";

const response: TotemConformanceResponse = {
  file_id: 4,
  asset_id: 8,
  overall_metrics: {
    temporal: { fitness: 0.9, precision: 0.8 },
    log_cardinality: { fitness: 0.7, precision: 0.6 },
    event_cardinality: { fitness: null, precision: null },
  },
  object_type_metrics: {},
  type_pair_metrics: [
    {
      source_type: "Order",
      target_type: "Item",
      temporal: { model_relation: "D", fitness: 0.92, precision: 0.8 },
      log_cardinality: { model_relation: "1..*", fitness: 0.86, precision: 0.7 },
      event_cardinality: { model_relation: "1", fitness: null, precision: null },
    },
    {
      source_type: "Item",
      target_type: "Order",
      temporal: { model_relation: "Di", fitness: 0.7, precision: 0.6 },
      log_cardinality: { model_relation: "0...1", fitness: 0.78, precision: 0.7 },
      event_cardinality: { model_relation: "1", fitness: null, precision: null },
    },
  ],
  histograms: {
    temporal: [],
    log_cardinality: [],
    event_cardinality: [],
    event_cardinality_by_activity: [],
    temporal_by_relation_type: [],
    log_cardinality_by_relation_type: [],
  },
};

describe("TOTeM conformance presentation", () => {
  it("uses the weaker directional fitness for a visualized pair", () => {
    const lookup = createTotemConformanceLookup(response);

    expect(getPairFitness(lookup, "Order", "Item", "temporal")).toBe(0.7);
    expect(getPairFitness(lookup, "Order", "Item", "log_cardinality")).toBe(
      0.78
    );
    expect(getPairFitness(lookup, "Order", "Item", "event_cardinality")).toBeNull();
  });

  it("maps reference thresholds to explicit fitness bands", () => {
    expect(getFitnessBand(0.74).id).toBe("poor");
    expect(getFitnessBand(0.75).id).toBe("moderate");
    expect(getFitnessBand(0.9).id).toBe("strong");
    expect(getFitnessBand(null).id).toBe("unavailable");
  });

  it("formats available and unavailable metrics consistently", () => {
    expect(formatConformanceMetric(0.876)).toBe("0.88");
    expect(formatConformanceMetric(null)).toBe("-");
  });
});
