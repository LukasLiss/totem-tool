import {
  TOTEM_NODE_HEIGHT,
  totemNodeWidth,
} from "@/components/totem/totemTheme";

import type {
  TotemVisualizationModel,
  TotemVisualizationPosition,
} from "./visualizationModel";

// A relation needs room along its line for a log cardinality near each end
// and the event cardinality oval in the middle, so the gaps are driven by the
// annotations rather than by the boxes.
const HORIZONTAL_GAP = 180;
const VERTICAL_GAP = 180;

/**
 * Lay out TOTeM object types by containment depth. In D(a,b), a is placed
 * below b; Di(a,b) expresses the inverse and places b below a. Other temporal
 * relations stay within their current containment layer.
 */
export function computeTotemNodePositions(
  model: TotemVisualizationModel
): ReadonlyMap<string, TotemVisualizationPosition> {
  const parentsByChild = new Map<string, Set<string>>(
    model.nodes.map((node) => [node.id, new Set<string>()])
  );

  for (const relation of model.relations) {
    if (relation.temporal === "D") {
      parentsByChild.get(relation.source)?.add(relation.target);
    } else if (relation.temporal === "Di") {
      parentsByChild.get(relation.target)?.add(relation.source);
    }
  }

  const depthByNode = new Map<string, number>();
  const visiting = new Set<string>();
  const cycleNodes = new Set<string>();

  const resolveDepth = (nodeId: string): number => {
    const cached = depthByNode.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) {
      cycleNodes.add(nodeId);
      return 0;
    }

    visiting.add(nodeId);
    let depth = 0;
    for (const parent of parentsByChild.get(nodeId) ?? []) {
      if (visiting.has(parent)) {
        cycleNodes.add(parent);
        cycleNodes.add(nodeId);
        continue;
      }
      depth = Math.max(depth, resolveDepth(parent) + 1);
    }
    visiting.delete(nodeId);
    depthByNode.set(nodeId, cycleNodes.has(nodeId) ? 0 : depth);
    return depthByNode.get(nodeId) ?? 0;
  };

  for (const node of model.nodes) resolveDepth(node.id);

  const rows = new Map<number, string[]>();
  for (const node of model.nodes) {
    const depth = depthByNode.get(node.id) ?? 0;
    const row = rows.get(depth);
    if (row) row.push(node.id);
    else rows.set(depth, [node.id]);
  }

  // Object type boxes size themselves to their name, so a row is laid out by
  // walking along it rather than by multiplying a fixed column width.
  const labels = new Map(model.nodes.map((node) => [node.id, node.label]));
  const positions = new Map<string, TotemVisualizationPosition>();
  for (const [depth, nodeIds] of Array.from(rows.entries()).sort(
    ([left], [right]) => left - right
  )) {
    nodeIds.sort((left, right) => left.localeCompare(right));
    let x = 0;
    for (const nodeId of nodeIds) {
      positions.set(nodeId, {
        x,
        y: depth * (TOTEM_NODE_HEIGHT + VERTICAL_GAP),
      });
      x += totemNodeWidth(labels.get(nodeId) ?? nodeId) + HORIZONTAL_GAP;
    }
  }

  for (const node of model.nodes) {
    if (node.position) positions.set(node.id, { ...node.position });
  }

  return positions;
}
