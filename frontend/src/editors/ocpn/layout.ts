import ELK from 'elkjs/lib/elk.bundled.js';

import { nodeSize, type FlowState } from './model';
import type { ArcFlowEdge, OcpnFlowNode } from './types';

const elk = new ELK();

/** ELK layered left→right layout; returns nodes with new positions. */
export async function layoutOcpn(
  nodes: OcpnFlowNode[],
  edges: ArcFlowEdge[],
): Promise<OcpnFlowNode[]> {
  if (nodes.length === 0) return nodes;

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '60',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
    },
    children: nodes.map((node) => {
      const { width, height } = nodeSize(node);
      return {
        id: node.id,
        width: node.measured?.width ?? width,
        height: node.measured?.height ?? height,
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const result = await elk.layout(graph);
  const positions = new Map(
    (result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]),
  );

  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, position } : node;
  });
}

export type { FlowState };
