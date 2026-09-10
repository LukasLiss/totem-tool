import type { ProjectAsset } from "@/api/assetsApi";
import type { TotemConformanceResponse } from "@/api/totemConformanceApi";

export function createTotemAsset(
  overrides: Partial<ProjectAsset> = {}
): ProjectAsset {
  return {
    id: 4,
    project: 7,
    name: "Reference TOTeM",
    asset_type: "TOTEM",
    content_json: createCanonicalTotemContent(),
    metadata: {},
    created_by: 1,
    created_at: "2026-07-22T10:00:00Z",
    updated_at: "2026-07-22T10:00:00Z",
    ...overrides,
  };
}

export function createCanonicalTotemContent(): Record<string, unknown> {
  return {
    schema: "totem",
    version: 1,
    tempgraph: {
      nodes: ["Order", "Item"],
      D: [["Order", "Item"]],
      Di: [["Item", "Order"]],
      I: [],
      Ii: [],
      P: [],
    },
    cardinalities: [
      {
        from: "Order",
        to: "Item",
        log_cardinality: "1..*",
        event_cardinality: "0...1",
      },
      {
        from: "Item",
        to: "Order",
        log_cardinality: "1",
        event_cardinality: "1",
      },
    ],
    type_relations: [["Item", "Order"]],
    all_event_types: ["Create Order", "Pick Item"],
    object_type_to_event_types: {
      Order: ["Create Order"],
      Item: ["Pick Item"],
    },
  };
}

export function createConformanceResponse(
  overrides: Partial<TotemConformanceResponse> = {}
): TotemConformanceResponse {
  return {
    file_id: 12,
    asset_id: 4,
    overall_metrics: {
      temporal: { fitness: 0.82, precision: 0.91 },
      log_cardinality: { fitness: 0.74, precision: 0.88 },
      event_cardinality: { fitness: 0.93, precision: 0.84 },
    },
    object_type_metrics: {
      Order: {
        temporal: { avg_fitness: 0.82, avg_precision: 0.91 },
        log_cardinality: { avg_fitness: 0.74, avg_precision: 0.88 },
        event_cardinality: { avg_fitness: 0.93, avg_precision: 0.84 },
      },
      Item: {
        temporal: { avg_fitness: 0.76, avg_precision: 0.81 },
        log_cardinality: { avg_fitness: 0.68, avg_precision: 0.79 },
        event_cardinality: { avg_fitness: 0.9, avg_precision: 0.86 },
      },
    },
    type_pair_metrics: [
      {
        source_type: "Order",
        target_type: "Item",
        temporal: { model_relation: "D", fitness: 0.92, precision: 0.91 },
        log_cardinality: {
          model_relation: "1..*",
          fitness: 0.84,
          precision: 0.88,
        },
        event_cardinality: {
          model_relation: "0...1",
          fitness: 0.95,
          precision: 0.84,
        },
      },
      {
        source_type: "Item",
        target_type: "Order",
        temporal: { model_relation: "Di", fitness: 0.62, precision: 0.71 },
        log_cardinality: {
          model_relation: "1",
          fitness: 0.78,
          precision: 0.79,
        },
        event_cardinality: {
          model_relation: "1",
          fitness: 0.91,
          precision: 0.86,
        },
      },
    ],
    histograms: {
      temporal: [
        {
          source_type: "Order",
          target_type: "Item",
          counts: { total: 10, D: 9, I: 1 },
        },
        {
          source_type: "Item",
          target_type: "Order",
          counts: { total: 10, Di: 6, P: 4 },
        },
      ],
      log_cardinality: [
        {
          source_type: "Order",
          target_type: "Item",
          counts: { total: 10, "1..*": 8, "1": 2 },
        },
      ],
      event_cardinality: [
        {
          source_type: "Order",
          target_type: "Item",
          counts: { total: 10, "0...1": 9, "1": 1 },
        },
      ],
      event_cardinality_by_activity: [
        {
          source_type: "Order",
          target_type: "Item",
          activity: "Pick Item",
          counts: { total: 5, "0...1": 4, "1": 1 },
        },
      ],
      temporal_by_relation_type: [
        {
          source_type: "Order",
          target_type: "Item",
          relation_type: "contains",
          counts: { total: 5, D: 4, I: 1 },
        },
      ],
      log_cardinality_by_relation_type: [
        {
          source_type: "Order",
          target_type: "Item",
          relation_type: "contains",
          counts: { total: 5, "1..*": 4, "1": 1 },
        },
      ],
    },
    ...overrides,
  };
}
