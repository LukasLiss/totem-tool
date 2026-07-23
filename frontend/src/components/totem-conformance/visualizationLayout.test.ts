import { describe, expect, it } from "vitest";

import { computeTotemNodePositions } from "./visualizationLayout";
import type { TotemVisualizationModel } from "./visualizationModel";

function model(
  relations: TotemVisualizationModel["relations"],
  storedPosition?: { x: number; y: number }
): TotemVisualizationModel {
  return {
    schema: "totem",
    version: 1,
    nodes: [
      { id: "Container", label: "Container" },
      { id: "Item", label: "Item", position: storedPosition },
      { id: "Order", label: "Order" },
    ],
    relations,
    eventTypes: [],
    eventTypesByObjectType: {},
    warnings: [],
  };
}

const annotation = { log: "1", event: "1" };

describe("TOTeM visualization layout", () => {
  it("places objects below the object type that contains them", () => {
    const positions = computeTotemNodePositions(
      model([
        {
          id: "container-item",
          source: "Item",
          target: "Container",
          temporal: "D",
          sourceToTarget: annotation,
          targetToSource: annotation,
        },
      ])
    );

    expect(positions.get("Item")?.y).toBeGreaterThan(
      positions.get("Container")?.y ?? 0
    );
    expect(positions.get("Order")?.y).toBe(positions.get("Container")?.y);
  });

  it("interprets inverse dependency direction", () => {
    const positions = computeTotemNodePositions(
      model([
        {
          id: "container-item",
          source: "Container",
          target: "Item",
          temporal: "Di",
          sourceToTarget: annotation,
          targetToSource: annotation,
        },
      ])
    );

    expect(positions.get("Item")?.y).toBeGreaterThan(
      positions.get("Container")?.y ?? 0
    );
  });

  it("preserves stored positions without destabilizing fallback positions", () => {
    const positions = computeTotemNodePositions(model([], { x: 480, y: 220 }));

    expect(positions.get("Item")).toEqual({ x: 480, y: 220 });
    expect(positions.get("Container")).toBeDefined();
    expect(positions.get("Order")).toBeDefined();
  });
});
