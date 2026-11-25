/**
 * Initial placement of TOTeM object types, shared by the TOTeM Miner and the
 * TOTeM conformance view so both start from the same picture of a model.
 */

export type TotemLayoutEdge = { from: string; to: string };
export type TotemLayoutPoint = { x: number; y: number };

/**
 * Positions the highest-degree (hub) node at the center of the canvas and arranges
 * surrounding connected nodes in an ellipse ordered by a DFS traversal to minimize
 * edge crossings. Isolated object types are placed in a row below the graph.
 *
 * Returned positions are the *centers* of the object type boxes.
 */
export function computeTotemHubLayout(
  nodeIds: readonly string[],
  edges: readonly TotemLayoutEdge[],
  width: number,
  height: number,
  nodeWidth: (id: string) => number,
): Map<string, TotemLayoutPoint> {
  if (nodeIds.length === 0) return new Map();
  if (nodeIds.length === 1) {
    return new Map([[nodeIds[0], { x: width / 2, y: height / 2 }]]);
  }

  // Count degree (incoming + outgoing) of each node
  const degree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const e of edges) {
    if (degree.has(e.from)) degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    if (degree.has(e.to)) degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  // Separate connected nodes from isolated (degree 0) nodes
  const connectedNodeIds = nodeIds.filter((id) => (degree.get(id) ?? 0) > 0);
  const isolatedNodes = nodeIds.filter((id) => (degree.get(id) ?? 0) === 0);

  const activeNodes = connectedNodeIds.length > 0 ? connectedNodeIds : nodeIds;

  // Find hub node (node with maximum degree)
  let hubNode = activeNodes[0];
  let maxDeg = -1;
  for (const id of activeNodes) {
    const deg = degree.get(id) ?? 0;
    if (deg > maxDeg) {
      maxDeg = deg;
      hubNode = id;
    }
  }

  const nonHubNodes = activeNodes.filter((id) => id !== hubNode);

  // Build adjacency list for non-hub nodes (subgraph)
  const nonHubAdj = new Map<string, string[]>(nonHubNodes.map((id) => [id, []]));
  for (const e of edges) {
    if (e.from === hubNode || e.to === hubNode) continue;
    if (nonHubAdj.has(e.from) && nonHubAdj.has(e.to)) {
      nonHubAdj.get(e.from)!.push(e.to);
      nonHubAdj.get(e.to)!.push(e.from);
    }
  }

  // Sort non-hub nodes alphabetically to ensure stable DFS traversal starting node order
  const sortedNonHubNodes = [...nonHubNodes].sort();

  // Traverse the non-hub subgraph using DFS to order the nodes circularly to minimize crossings
  const visited = new Set<string>();
  const sortedNonHub: string[] = [];

  function dfs(node: string) {
    visited.add(node);
    sortedNonHub.push(node);
    for (const nb of nonHubAdj.get(node) ?? []) {
      if (!visited.has(nb)) {
        dfs(nb);
      }
    }
  }

  // Start DFS with endpoints of paths (nodes of degree <= 1 in the non-hub subgraph)
  for (const node of sortedNonHubNodes) {
    if (!visited.has(node) && (nonHubAdj.get(node) ?? []).length <= 1) {
      dfs(node);
    }
  }
  // Fallback for remaining nodes (e.g. cycle components)
  for (const node of sortedNonHubNodes) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  const cx = width / 2;
  const cy = height / 2;
  const positions = new Map<string, TotemLayoutPoint>();

  if (sortedNonHub.length === 0) {
    positions.set(hubNode, { x: cx, y: cy });
  } else {
    // Determine number of concentric/staggered rings to avoid node overlap
    // For many nodes (like Bundestag with 30+ types and long labels),
    // a single ring creates severe overlapping.
    const M = sortedNonHub.length;
    const maxW = Math.max(...sortedNonHub.map((id) => nodeWidth(id)), 120);

    const numRings = M <= 8 ? 1 : M <= 18 ? 2 : 3;
    const nodesPerRing = Math.ceil(M / numRings);
    const requiredArcPerNode = Math.max(maxW + 40, 200);
    const ringCircumference = nodesPerRing * requiredArcPerNode;

    const baseR = Math.max(width * 0.35, ringCircumference / (2 * Math.PI));
    const baseRx = Math.max(260, baseR * 1.15);
    const baseRy = Math.max(200, baseR * 0.85);

    positions.set(hubNode, { x: cx, y: cy });

    const startAngle = 1.92;
    const angleStep = (2 * Math.PI) / M;

    sortedNonHub.forEach((id, idx) => {
      const ring = numRings > 1 ? idx % numRings : 0;
      const ringScale = 1 + ring * 0.4;
      const rx = baseRx * ringScale;
      const ry = baseRy * ringScale;

      const angle = startAngle + idx * angleStep;
      const x = cx + rx * Math.cos(angle);
      const y = cy + ry * Math.sin(angle);
      positions.set(id, { x, y });
    });
  }

  // Position any isolated (degree 0) nodes in a clean row below the graph
  if (connectedNodeIds.length > 0 && isolatedNodes.length > 0) {
    let maxY = cy;
    positions.forEach((p) => {
      if (p.y > maxY) maxY = p.y;
    });
    const isolatedStartY = maxY + 140;
    const totalIsoW = isolatedNodes.reduce((acc, id) => acc + nodeWidth(id) + 20, 0);
    let curX = cx - totalIsoW / 2;
    isolatedNodes.forEach((id) => {
      const w = nodeWidth(id);
      positions.set(id, { x: curX + w / 2, y: isolatedStartY });
      curX += w + 20;
    });
  }

  return positions;
}
