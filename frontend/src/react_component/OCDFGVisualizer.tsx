import ELK from 'elkjs/lib/elk.bundled.js';
import { useState, useEffect, useCallback } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  Panel,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Define specific types for the data we expect from the backend
interface DfgNode {
  id: string;
  label: string;
}

interface DfgLink {
  source: string;
  target: string;
}

interface DfgData {
  dfg: {
    nodes: DfgNode[];
    links: DfgLink[];
  };
}

const elk = new ELK();

/**
 * Calculates the rank of each node based on its longest path from a source node.
 * This determines the horizontal layer for the layout.
 * @param nodes The list of nodes from the DFG.
 * @param links The list of links from the DFG.
 * @returns A Map where keys are node IDs and values are their calculated ranks.
 */
function calculateNodeRanks(nodes: DfgNode[], links: DfgLink[]): Map<string, number> {
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
  while(head < queue.length) {
    const u = queue[head++];
    const uRank = ranks.get(u.id)!;

    for (const v_id of adj.get(u.id) || []) {
      const vRank = ranks.get(v_id) || 0;
      // The rank of a node is the maximum rank of its predecessors plus one
      ranks.set(v_id, Math.max(vRank, uRank + 1));

      const vInDegree = inDegree.get(v_id)! - 1;
      inDegree.set(v_id, vInDegree);
      if (vInDegree === 0) {
          const vNode = nodes.find(n => n.id === v_id);
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

// --- Updated ELK Layout Function ---
const getLayoutedElements = (nodes: Node[], edges: Edge[], ranks: Map<string, number>) => {
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
    edges: edges,
  };

  return elk.layout(graph).then(g => ({
    nodes: g.children!.map(n => ({ ...n, position: { x: n.x, y: n.y } })),
    edges: g.edges || [],
  })).catch(console.error);
};


function OCDFGVisualizer() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const { fitView } = useReactFlow();

  const onNodesChange = useCallback((c) => setNodes((nds) => applyNodeChanges(c, nds)), []);
  const onEdgesChange = useCallback((c) => setEdges((eds) => applyEdgeChanges(c, eds)), []);

  useEffect(() => {
    fetch('http://127.0.0.1:8000/api/ocdfg/')
      .then((response) => response.json())
      .then((data: DfgData) => {
        const { nodes: dfgNodes, links: dfgLinks } = data.dfg;

        // 1. Calculate ranks before creating the visual nodes
        const ranks = calculateNodeRanks(dfgNodes, dfgLinks);

        // Create standard React Flow nodes (no custom types)
        const initialNodes: Node[] = dfgNodes.map((node) => ({
          id: node.id,
          data: { label: node.label || node.id },
          position: { x: 0, y: 0 }, // Position will be set by ELK
        }));

        const initialEdges: Edge[] = dfgLinks.map((link, index) => ({
          id: `e${index}-${link.source}-${link.target}`,
          source: link.source,
          target: link.target,
          markerEnd: { type: 'arrowclosed', width: 20, height: 20, color: '#b1b1b7' },
          style: { strokeWidth: 2, stroke: '#b1b1b7' },
        }));

        // 2. Pass the ranks to the layout function to generate positions
        getLayoutedElements(initialNodes, initialEdges, ranks).then(({ nodes, edges }) => {
          setNodes(nodes);
          setEdges(edges);
          window.requestAnimationFrame(() => fitView());
        });
      })
      .catch(console.error);
  }, [fitView]);
  
  // The relayout button also needs to calculate ranks
  const onLayout = useCallback(() => {
    const currentDfgNodes = nodes.map(n => ({ id: n.id, label: n.data.label }));
    const currentDfgLinks = edges.map(e => ({ source: e.source!, target: e.target! }));
    const ranks = calculateNodeRanks(currentDfgNodes, currentDfgLinks);

    getLayoutedElements(nodes, edges, ranks).then(({ nodes, edges }) => {
        setNodes(nodes);
        setEdges(edges);
        window.requestAnimationFrame(() => fitView());
    });
  }, [nodes, edges, fitView]);

  return (
    <div style={{ height: 'calc(100vh - 50px)', width: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Controls />
        <Background />
        <Panel position="top-right">
          <button onClick={onLayout}>Relayout</button>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export default OCDFGVisualizer;

