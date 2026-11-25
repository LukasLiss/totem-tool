import { computeTotemHubLayout } from "@/components/totem/totemLayout";
import {
  TOTEM_NODE_HEIGHT,
  totemNodeWidth,
} from "@/components/totem/totemTheme";

import type {
  TotemVisualizationModel,
  TotemVisualizationPosition,
} from "./visualizationModel";

// The TOTeM Miner lays its model out on the canvas it is shown in. The
// conformance canvas fits its view to the boxes afterwards, so a fixed
// reference canvas of a typical size is enough to get the same arrangement.
const REFERENCE_CANVAS_WIDTH = 1000;
const REFERENCE_CANVAS_HEIGHT = 600;

/**
 * Lay out TOTeM object types with the same hub-centred layout the TOTeM Miner
 * uses, so a model looks the same in both views. Positions stored with the
 * model take precedence over the generated ones.
 *
 * React Flow positions a node by its top-left corner, while the shared layout
 * returns box centres, hence the shift by half a box.
 */
export function computeTotemNodePositions(
  model: TotemVisualizationModel
): ReadonlyMap<string, TotemVisualizationPosition> {
  const labels = new Map(model.nodes.map((node) => [node.id, node.label]));
  const widthOf = (id: string) => totemNodeWidth(labels.get(id) ?? id);
  // Sorted like the miner's object types, so ties resolve the same way.
  const nodeIds = model.nodes.map((node) => node.id).sort();
  const centers = computeTotemHubLayout(
    nodeIds,
    model.relations.map((relation) => ({
      from: relation.source,
      to: relation.target,
    })),
    REFERENCE_CANVAS_WIDTH,
    REFERENCE_CANVAS_HEIGHT,
    widthOf
  );

  const positions = new Map<string, TotemVisualizationPosition>();
  for (const [id, center] of centers) {
    positions.set(id, {
      x: Math.round(center.x - widthOf(id) / 2),
      y: Math.round(center.y - TOTEM_NODE_HEIGHT / 2),
    });
  }

  for (const node of model.nodes) {
    if (node.position) positions.set(node.id, { ...node.position });
  }

  return positions;
}
