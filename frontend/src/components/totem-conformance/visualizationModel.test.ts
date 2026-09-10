import { describe, expect, it } from "vitest";

import {
  createTotemVisualizationModel,
  TotemVisualizationModelError,
} from "./visualizationModel";

const canonicalModel = {
  schema: "totem",
  version: 1,
  tempgraph: {
    nodes: ["Item", "Order", "Isolated"],
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
      event_cardinality: "0...*",
    },
    {
      from: "Item",
      to: "Order",
      log_cardinality: "0...1",
      event_cardinality: "1",
    },
  ],
  type_relations: [["Item", "Order"]],
  all_event_types: ["Create Order", "Pick Item"],
  object_type_to_event_types: {
    Item: ["Pick Item"],
    Order: ["Create Order"],
  },
  layout: {
    objectTypes: {
      Order: {
        position: { x: 120, y: 80 },
        color: "#2563eb",
      },
    },
  },
};

describe("TOTeM visualization model adapter", () => {
  it("collapses inverse relations and retains directional cardinalities", () => {
    const model = createTotemVisualizationModel(canonicalModel);

    expect(model.nodes).toEqual([
      { id: "Item", label: "Item" },
      {
        id: "Order",
        label: "Order",
        position: { x: 120, y: 80 },
        color: "#2563eb",
      },
      { id: "Isolated", label: "Isolated" },
    ]);
    expect(model.relations).toEqual([
      {
        id: '["Order","Item"]',
        source: "Order",
        target: "Item",
        temporal: "D",
        sourceToTarget: { log: "1..*", event: "0...*" },
        targetToSource: { log: "0...1", event: "1" },
      },
    ]);
    expect(model.warnings).toEqual([]);
  });

  it("supports inverse-only relations and relations derived from cardinalities", () => {
    const model = createTotemVisualizationModel({
      ...canonicalModel,
      tempgraph: {
        ...canonicalModel.tempgraph,
        D: [],
        Di: [["Item", "Order"]],
      },
      type_relations: [],
    });

    expect(model.relations[0]).toMatchObject({
      source: "Item",
      target: "Order",
      temporal: "Di",
    });
  });

  it("reports inconsistent inverse temporal relations", () => {
    const model = createTotemVisualizationModel({
      ...canonicalModel,
      tempgraph: {
        ...canonicalModel.tempgraph,
        Di: [],
        P: [["Item", "Order"]],
      },
    });

    expect(model.relations[0].temporal).toBe("D");
    expect(model.warnings).toEqual([
      "Order and Item declare inconsistent inverse temporal relations; D is displayed.",
    ]);
  });

  it("rejects malformed canonical data before rendering", () => {
    expect(() =>
      createTotemVisualizationModel({
        ...canonicalModel,
        tempgraph: {
          ...canonicalModel.tempgraph,
          D: [["Order", "Unknown"]],
        },
      })
    ).toThrow(TotemVisualizationModelError);
  });
});
