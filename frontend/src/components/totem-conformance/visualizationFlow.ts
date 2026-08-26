import type { Edge, Node } from "@xyflow/react";

import { assignTypeColors } from "@/editors/shared/colors";

import {
  getFitnessColor,
  getPairFitness,
} from "./conformancePresentation";
import type {
  ConformanceDimension,
  TotemConformanceLookup,
} from "./conformanceLookup";
import {
  computeTotemNodePositions,
  TOTEM_NODE_HEIGHT,
  TOTEM_NODE_WIDTH,
} from "./visualizationLayout";
import type {
  TotemCardinalityAnnotation,
  TotemTemporalRelation,
  TotemVisualizationModel,
} from "./visualizationModel";

export type TotemConformanceNodeData = {
  name: string;
  color: string;
};

export type TotemConformanceEdgeData = {
  temporal: TotemTemporalRelation | null;
  sourceToTarget: TotemCardinalityAnnotation;
  targetToSource: TotemCardinalityAnnotation;
  strokeColor?: string;
};

export type TotemConformanceNodeType = Node<
  TotemConformanceNodeData,
  "totemConformanceNode"
>;

export type TotemConformanceEdgeType = Edge<
  TotemConformanceEdgeData,
  "totemConformanceEdge"
>;

export interface TotemFlowElements {
  nodes: TotemConformanceNodeType[];
  edges: TotemConformanceEdgeType[];
}

export interface TotemFlowOptions {
  conformance?: TotemConformanceLookup;
  dimension?: ConformanceDimension;
  selectedObjectTypeId?: string | null;
  selectedRelationId?: string | null;
}

export function createTotemFlowElements(
  model: TotemVisualizationModel,
  options: TotemFlowOptions = {}
): TotemFlowElements {
  const positions = computeTotemNodePositions(model);
  const colors = assignTypeColors(
    model.nodes.map((node) => ({ name: node.id, color: node.color }))
  );

  return {
    nodes: model.nodes.map((node) => ({
      id: node.id,
      type: "totemConformanceNode",
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      width: TOTEM_NODE_WIDTH,
      height: TOTEM_NODE_HEIGHT,
      selected: node.id === options.selectedObjectTypeId,
      data: {
        name: node.label,
        color: colors[node.id],
      },
    })),
    edges: model.relations.map((relation) => {
      const fitness =
        options.conformance && options.dimension
          ? getPairFitness(
              options.conformance,
              relation.source,
              relation.target,
              options.dimension
            )
          : null;
      return {
        id: relation.id,
        type: "totemConformanceEdge",
        source: relation.source,
        target: relation.target,
        selected: relation.id === options.selectedRelationId,
        data: {
          temporal: relation.temporal,
          sourceToTarget: relation.sourceToTarget,
          targetToSource: relation.targetToSource,
          strokeColor: getFitnessColor(fitness),
        },
      };
    }),
  };
}
