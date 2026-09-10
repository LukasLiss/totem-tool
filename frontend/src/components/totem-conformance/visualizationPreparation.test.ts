import { describe, expect, it } from "vitest";

import type { TotemConformanceResponse } from "@/api/totemConformanceApi";

import {
  createCanonicalTotemContent,
  createConformanceResponse,
  createTotemAsset,
} from "./testFixtures";
import { prepareTotemVisualization } from "./visualizationPreparation";

describe("TOTeM visualization preparation", () => {
  it("prepares matching canonical model and result data", () => {
    const prepared = prepareTotemVisualization(
      createTotemAsset(),
      createConformanceResponse(),
      12
    );

    expect(prepared.status).toBe("ready");
    if (prepared.status === "ready") {
      expect(prepared.model.nodes.map(({ id }) => id)).toEqual(["Order", "Item"]);
      expect(prepared.model.relations).toHaveLength(1);
    }
  });

  it("rejects missing and stale model contexts", () => {
    expect(
      prepareTotemVisualization(null, createConformanceResponse(), 12).status
    ).toBe("unavailable");
    expect(
      prepareTotemVisualization(
        createTotemAsset(),
        createConformanceResponse({ asset_id: 9 }),
        12
      ).status
    ).toBe("unavailable");
    expect(
      prepareTotemVisualization(
        createTotemAsset(),
        createConformanceResponse({ file_id: 13 }),
        12
      ).status
    ).toBe("unavailable");
  });

  it.each([
    {
      label: "incomplete relation metrics",
      mutate: (result: TotemConformanceResponse) => ({
        ...result,
        type_pair_metrics: [{ source_type: "Order", target_type: "Item" }],
      }),
    },
    {
      label: "incomplete object-type metrics",
      mutate: (result: TotemConformanceResponse) => ({
        ...result,
        object_type_metrics: { Order: { temporal: {} } },
      }),
    },
    {
      label: "non-finite aggregate metrics",
      mutate: (result: TotemConformanceResponse) => ({
        ...result,
        overall_metrics: {
          ...result.overall_metrics,
          temporal: { fitness: Number.NaN, precision: 0.8 },
        },
      }),
    },
    {
      label: "negative histogram counts",
      mutate: (result: TotemConformanceResponse) => ({
        ...result,
        histograms: {
          ...result.histograms,
          temporal: [
            { source_type: "Order", target_type: "Item", counts: { D: -1 } },
          ],
        },
      }),
    },
  ])("reports $label before rendering", ({ mutate }) => {
    const malformed = mutate(
      createConformanceResponse()
    ) as unknown as TotemConformanceResponse;

    expect(
      prepareTotemVisualization(createTotemAsset(), malformed, 12)
    ).toMatchObject({
      status: "invalid",
      title: "Conformance result cannot be displayed",
    });
  });

  it("reports invalid and empty canonical models", () => {
    const invalid = prepareTotemVisualization(
      createTotemAsset({ content_json: { schema: "totem", version: 2 } }),
      createConformanceResponse(),
      12
    );
    const emptyContent = createCanonicalTotemContent();
    const tempgraph = emptyContent.tempgraph as Record<string, unknown>;
    tempgraph.nodes = [];
    tempgraph.D = [];
    tempgraph.Di = [];
    emptyContent.cardinalities = [];
    emptyContent.type_relations = [];
    emptyContent.all_event_types = [];
    emptyContent.object_type_to_event_types = {};
    const empty = prepareTotemVisualization(
      createTotemAsset({ content_json: emptyContent }),
      createConformanceResponse(),
      12
    );

    expect(invalid.status).toBe("invalid");
    expect(empty).toMatchObject({ status: "empty", title: "TOTeM model is empty" });
  });

  it("reports a structurally valid result without metric data", () => {
    const emptyResult = createConformanceResponse({
      overall_metrics: {
        temporal: { fitness: null, precision: null },
        log_cardinality: { fitness: null, precision: null },
        event_cardinality: { fitness: null, precision: null },
      },
      object_type_metrics: {},
      type_pair_metrics: [],
      histograms: {
        temporal: [],
        log_cardinality: [],
        event_cardinality: [],
        event_cardinality_by_activity: [],
        temporal_by_relation_type: [],
        log_cardinality_by_relation_type: [],
      },
    });

    expect(
      prepareTotemVisualization(createTotemAsset(), emptyResult, 12)
    ).toMatchObject({
      status: "empty",
      title: "No conformance data returned",
    });
  });
});
