import { MarkerType } from '@xyflow/react';

import { placeTypeMap, type FlowState } from './model';
import {
  FALLBACK_TYPE_COLOR,
  isPlaceNode,
  type ArcFlowEdge,
  type OcpnFlowNode,
} from './types';

/**
 * Derive presentation data the editor computes on the fly: place colors,
 * transition type-dots, and colored arrow markers per arc.
 */
export function toDisplay(state: FlowState): {
  nodes: OcpnFlowNode[];
  edges: ArcFlowEdge[];
} {
  const typeColors: Record<string, string> = {};
  for (const type of state.objectTypes) typeColors[type.name] = type.color;
  const placeTypes = placeTypeMap(state.nodes);

  const touched = new Map<string, Set<string>>();
  for (const edge of state.edges) {
    const transition = placeTypes.has(edge.source) ? edge.target : edge.source;
    const type = placeTypes.get(placeTypes.has(edge.source) ? edge.source : edge.target);
    if (!type) continue;
    if (!touched.has(transition)) touched.set(transition, new Set());
    touched.get(transition)!.add(type);
  }

  const nodes = state.nodes.map((node) => {
    if (isPlaceNode(node)) {
      return {
        ...node,
        data: {
          ...node.data,
          color: typeColors[node.data.objectType] ?? FALLBACK_TYPE_COLOR,
        },
      };
    }
    const types = touched.get(node.id);
    return {
      ...node,
      data: {
        ...node.data,
        typeDotColors: state.objectTypes
          .filter((t) => types?.has(t.name))
          .map((t) => t.color),
      },
    };
  }) as OcpnFlowNode[];

  const edges = state.edges.map((edge) => {
    const type =
      placeTypes.get(placeTypes.has(edge.source) ? edge.source : edge.target) ?? '';
    const color = typeColors[type] ?? FALLBACK_TYPE_COLOR;
    const variable = edge.data?.variable === true;
    return {
      ...edge,
      data: { ...edge.data!, color, objectType: type },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        markerUnits: 'userSpaceOnUse',
        width: variable ? 22 : 18,
        height: variable ? 22 : 18,
      },
    };
  }) as ArcFlowEdge[];

  return { nodes, edges };
}

