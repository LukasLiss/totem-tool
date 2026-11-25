import { describe, expect, it } from "vitest";

import { createTotemConformanceLookup } from "./conformanceLookup";
import {
  createCanonicalTotemContent,
  createConformanceResponse,
} from "./testFixtures";
import { createTotemFlowElements } from "./visualizationFlow";
import { createTotemVisualizationModel } from "./visualizationModel";

describe("TOTeM visualization flow transformation", () => {
  it("maps model elements and preserves selected node and relation IDs", () => {
    const model = createTotemVisualizationModel(createCanonicalTotemContent());
    const relationId = model.relations[0].id;
    const elements = createTotemFlowElements(model, {
      selectedObjectTypeId: "Order",
      selectedRelationId: relationId,
    });

    expect(elements.nodes.find(({ id }) => id === "Order")?.selected).toBe(true);
    expect(elements.nodes.find(({ id }) => id === "Item")?.selected).toBe(false);
    expect(elements.edges[0].selected).toBe(true);
  });

  it("colors every element separately for both directions", () => {
    const model = createTotemVisualizationModel(createCanonicalTotemContent());
    const lookup = createTotemConformanceLookup(createConformanceResponse());
    const edge = createTotemFlowElements(model, { conformance: lookup }).edges[0];
    const forward = edge.source === "Order" ? "target" : "source";
    const reverse = forward === "target" ? "source" : "target";

    // Order → Item: temporal 0.91, log 0.84, event 0.84.
    expect(edge.data?.elementColors?.[forward]).toEqual({
      temporal: "#16A34A",
      log: "#D97706",
      event: "#D97706",
    });
    // Item → Order: temporal 0.62, log 0.78, event 0.86.
    expect(edge.data?.elementColors?.[reverse]).toEqual({
      temporal: "#DC2626",
      log: "#D97706",
      event: "#D97706",
    });
    expect(edge.data?.strokeColor).toBeUndefined();
  });

  it("uses the unavailable color when no pair metrics were returned", () => {
    const model = createTotemVisualizationModel(createCanonicalTotemContent());
    const lookup = createTotemConformanceLookup(
      createConformanceResponse({ type_pair_metrics: [] })
    );
    const unavailable = { temporal: "#94A3B8", log: "#94A3B8", event: "#94A3B8" };

    expect(
      createTotemFlowElements(model, { conformance: lookup }).edges[0].data
        ?.elementColors
    ).toEqual({ source: unavailable, target: unavailable });
  });

  it("leaves elements uncoloured without conformance data", () => {
    const model = createTotemVisualizationModel(createCanonicalTotemContent());
    expect(
      createTotemFlowElements(model).edges[0].data?.elementColors
    ).toBeUndefined();
  });
});
