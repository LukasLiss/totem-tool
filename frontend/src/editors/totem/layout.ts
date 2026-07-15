import ELK from 'elkjs/lib/elk.bundled.js';

import type { XY } from '@/editors/shared/model-types';

import type { TotemRelationEdgeType, TotemTypeNodeType } from './types';

const elk = new ELK();

const DEFAULT_WIDTH = 150;
const DEFAULT_HEIGHT = 56;

function circleLayout(nodes: TotemTypeNodeType[]): Record<string, XY> {
  const radius = Math.max(220, nodes.length * 55);
  const positions: Record<string, XY> = {};
  nodes.forEach((node, index) => {
    const angle = (2 * Math.PI * index) / Math.max(nodes.length, 1) - Math.PI / 2;
    positions[node.id] = {
      x: Math.round(radius * Math.cos(angle)),
      y: Math.round(radius * Math.sin(angle)),
    };
  });
  return positions;
}

/**
 * Auto layout for the object type graph. TOTeM graphs are small, dense and
 * undirected, so ELK "stress" (straight-line friendly) beats "layered";
 * falls back to a circle if ELK fails.
 */
export async function layoutTotemGraph(
  nodes: TotemTypeNodeType[],
  edges: TotemRelationEdgeType[],
): Promise<Record<string, XY>> {
  if (nodes.length === 0) return {};
  try {
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'org.eclipse.elk.stress',
        'org.eclipse.elk.stress.desiredEdgeLength': '280',
        'elk.spacing.nodeNode': '160',
      },
      children: nodes.map((node) => ({
        id: node.id,
        width: node.measured?.width ?? DEFAULT_WIDTH,
        height: node.measured?.height ?? DEFAULT_HEIGHT,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
    };
    const result = await elk.layout(graph);
    const positions: Record<string, XY> = {};
    for (const child of result.children ?? []) {
      if (typeof child.x === 'number' && typeof child.y === 'number') {
        positions[child.id] = { x: Math.round(child.x), y: Math.round(child.y) };
      }
    }
    if (Object.keys(positions).length !== nodes.length) return circleLayout(nodes);
    return positions;
  } catch {
    return circleLayout(nodes);
  }
}
