import { describe, expect, it } from "vitest";

import { computeTotemHubLayout } from "@/components/totem/totemLayout";
import {
  TOTEM_NODE_HEIGHT,
  totemNodeWidth,
} from "@/components/totem/totemTheme";

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

function relation(source: string, target: string) {
  return {
    id: `${source}-${target}`,
    source,
    target,
    temporal: "D" as const,
    sourceToTarget: annotation,
    targetToSource: annotation,
  };
}

describe("TOTeM visualization layout", () => {
  it("uses the TOTeM Miner's hub-centred layout", () => {
    const relations = [relation("Item", "Container"), relation("Order", "Container")];
    const positions = computeTotemNodePositions(model(relations));

    const centers = computeTotemHubLayout(
      ["Container", "Item", "Order"],
      relations.map((entry) => ({ from: entry.source, to: entry.target })),
      1000,
      600,
      totemNodeWidth
    );
    for (const id of ["Container", "Item", "Order"]) {
      expect(positions.get(id)).toEqual({
        x: Math.round((centers.get(id)?.x ?? 0) - totemNodeWidth(id) / 2),
        y: Math.round((centers.get(id)?.y ?? 0) - TOTEM_NODE_HEIGHT / 2),
      });
    }
  });

  it("places the most connected object type in the middle", () => {
    const positions = computeTotemNodePositions(
      model([relation("Item", "Container"), relation("Order", "Container")])
    );
    const container = positions.get("Container")!;
    const centerX = container.x + totemNodeWidth("Container") / 2;
    expect(Math.abs(centerX - 500)).toBeLessThanOrEqual(1);
    expect(positions.get("Item")).not.toEqual(container);
    expect(positions.get("Order")).not.toEqual(container);
  });

  it("preserves stored positions without destabilizing fallback positions", () => {
    const positions = computeTotemNodePositions(model([], { x: 480, y: 220 }));

    expect(positions.get("Item")).toEqual({ x: 480, y: 220 });
    expect(positions.get("Container")).toBeDefined();
    expect(positions.get("Order")).toBeDefined();
  });
});
