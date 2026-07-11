import ELK from 'elkjs/lib/elk.bundled.js';
import type { Edge, Node } from '@xyflow/react';

const elk = new ELK();

export async function getTotemLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  layoutDirection: 'TB' | 'LR' = 'TB'
) {
  // We need to build a hierarchical graph for ELK from the flat ReactFlow nodes array.
  // Nodes with no parentId are root nodes (Process Areas).
  // Nodes with a parentId are child nodes (Object Types).

  const rootNodes = nodes.filter((n) => !n.parentId);
  const childNodes = nodes.filter((n) => n.parentId);

  const nodeMap = new Map<string, any>();

  // Initialize root nodes
  rootNodes.forEach((n) => {
    nodeMap.set(n.id, {
      id: n.id,
      width: n.measured?.width ?? n.width ?? 300,
      height: n.measured?.height ?? n.height ?? 150,
      layoutOptions: {
        'elk.padding': '[top=50,left=30,bottom=30,right=30]', // Padding inside Process Areas
      },
      children: [],
    });
  });

  // Assign child nodes
  childNodes.forEach((n) => {
    const parent = nodeMap.get(n.parentId!);
    if (parent) {
      parent.children.push({
        id: n.id,
        width: n.measured?.width ?? n.width ?? 180,
        height: n.measured?.height ?? n.height ?? 80,
      });
    } else {
      // Fallback if parent not found
      nodeMap.set(n.id, {
        id: n.id,
        width: n.measured?.width ?? n.width ?? 180,
        height: n.measured?.height ?? n.height ?? 80,
      });
    }
  });

  // Map edges
  const elkEdges = edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': layoutDirection === 'LR' ? 'RIGHT' : 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '60',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      // 'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
    },
    children: Array.from(nodeMap.values()),
    edges: elkEdges,
  };

  try {
    const layoutedGraph = await elk.layout(graph);
    
    // Extract positions
    const newNodes = nodes.map((node) => {
      if (node.parentId) {
        // Child node
        const parent = layoutedGraph.children?.find((c: any) => c.id === node.parentId);
        const child = parent?.children?.find((c: any) => c.id === node.id);
        if (child) {
          return {
            ...node,
            position: { x: child.x, y: child.y },
          };
        }
      } else {
        // Root node
        const rootNode = layoutedGraph.children?.find((c: any) => c.id === node.id);
        if (rootNode) {
          return {
            ...node,
            position: { x: rootNode.x, y: rootNode.y },
            style: { ...node.style, width: rootNode.width, height: rootNode.height },
          };
        }
      }
      return node;
    });

    // Extract edge routing
    const newEdges = edges.map((edge) => {
      // Find edge in the layouted graph. 
      // ELK puts edges inside the lowest common ancestor of the source and target.
      // For simplicity, we search all edges in root and children.
      let elkEdge: any = layoutedGraph.edges?.find((e: any) => e.id === edge.id);
      
      if (!elkEdge && layoutedGraph.children) {
        for (const child of layoutedGraph.children) {
          elkEdge = child.edges?.find((e: any) => e.id === edge.id);
          if (elkEdge) break;
        }
      }

      if (elkEdge && elkEdge.sections && elkEdge.sections.length > 0) {
        const section = elkEdge.sections[0];
        const points = [];
        if (section.startPoint) points.push(section.startPoint);
        if (section.bendPoints) points.push(...section.bendPoints);
        if (section.endPoint) points.push(section.endPoint);
        
        return {
          ...edge,
          data: {
            ...edge.data,
            elkPoints: points,
          }
        };
      }
      return edge;
    });

    return { nodes: newNodes, edges: newEdges };
  } catch (error) {
    console.error('ELK Layout Error:', error);
    throw error;
  }
}
