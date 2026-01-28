import ELK from 'elkjs/lib/elk.bundled.js';
import type { Edge, Node } from '@xyflow/react';

export interface DfgNode {
  id: string;
  label: string;
  types?: string[];
}

export interface DfgLink {
  source: string;
  target: string;
  weight?: number;
  owners?: string[];
  ownerTypes?: string[];
  weights?: Record<string, number>;
}

const elk = new ELK();

/**
 * Calculates the rank of each node based on its longest path from a source node.
 * This determines the horizontal layer for the layout.
 * @param nodes The list of nodes from the DFG.
 * @param links The list of links from the DFG.
 * @returns A Map where keys are node IDs and values are their calculated ranks.
 */
export function calculateNodeRanks(nodes: DfgNode[], links: DfgLink[]): Map<string, number> {
  const ranks = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize data structures for graph traversal
  for (const node of nodes) {
    adj.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const link of links) {
    adj.get(link.source)?.push(link.target);
    inDegree.set(link.target, (inDegree.get(link.target) || 0) + 1);
  }

  // Find all source nodes (those with no incoming edges) to start the ranking
  const queue = nodes.filter(node => inDegree.get(node.id) === 0);
  for (const node of queue) {
    ranks.set(node.id, 0); // Source nodes are rank 0
  }

  // Process nodes in topological order to determine ranks
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    const uRank = ranks.get(u.id)!;

    for (const vId of adj.get(u.id) || []) {
      const vRank = ranks.get(vId) || 0;
      // The rank of a node is the maximum rank of its predecessors plus one
      ranks.set(vId, Math.max(vRank, uRank + 1));

      const vInDegree = inDegree.get(vId)! - 1;
      inDegree.set(vId, vInDegree);
      if (vInDegree === 0) {
        const vNode = nodes.find(n => n.id === vId);
        if (vNode) queue.push(vNode);
      }
    }
  }

  // Handle any nodes that might be part of a cycle and were not reached
  nodes.forEach(node => {
    if (!ranks.has(node.id)) {
      let maxPredecessorRank = -1;
      links.forEach(link => {
        if (link.target === node.id && ranks.has(link.source)) {
          maxPredecessorRank = Math.max(maxPredecessorRank, ranks.get(link.source)!);
        }
      });
      ranks.set(node.id, maxPredecessorRank + 1);
    }
  });

  return ranks;
}

// --- ELK Layout Function ---
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  ranks: Map<string, number>,
) {
  // Configure ELK for a layered, top-to-bottom layout
  const elkOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.layered.spacing.nodeNodeBetweenLayers': '120',
    'elk.spacing.nodeNode': '100',
  };

  const graph = {
    id: 'root',
    layoutOptions: elkOptions,
    children: nodes.map(node => ({
      ...node,
      width: 150,
      height: 50,
      // This is the key: assign each node to a horizontal "partition" based on its rank
      'elk.partition': ranks.get(node.id) || 0,
    })),
    edges,
  };

  return elk
    .layout(graph)
    .then(g => ({
      nodes: g.children!.map(n => ({ ...n, position: { x: n.x, y: n.y } })),
      edges: g.edges || [],
    }))
    .catch(error => {
      console.error(error);
      throw error;
    });
}
