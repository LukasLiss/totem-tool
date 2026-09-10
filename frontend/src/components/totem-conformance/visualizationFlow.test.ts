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

  it("colors each dimension using the weaker directional fitness", () => {
    const model = createTotemVisualizationModel(createCanonicalTotemContent());
    const lookup = createTotemConformanceLookup(createConformanceResponse());

    expect(
      createTotemFlowElements(model, {
        conformance: lookup,
        dimension: "temporal",
      }).edges[0].data?.strokeColor
    ).toBe("#DC2626");
    expect(
      createTotemFlowElements(model, {
        conformance: lookup,
        dimension: "log_cardinality",
      }).edges[0].data?.strokeColor
    ).toBe("#D97706");
    expect(
      createTotemFlowElements(model, {
        conformance: lookup,
        dimension: "event_cardinality",
      }).edges[0].data?.strokeColor
    ).toBe("#16A34A");
  });

  it("uses the unavailable color when no pair metrics were returned", () => {
    const model = createTotemVisualizationModel(createCanonicalTotemContent());
    const lookup = createTotemConformanceLookup(
      createConformanceResponse({ type_pair_metrics: [] })
    );

    expect(
      createTotemFlowElements(model, {
        conformance: lookup,
        dimension: "temporal",
      }).edges[0].data?.strokeColor
    ).toBe("#94A3B8");
  });
});
