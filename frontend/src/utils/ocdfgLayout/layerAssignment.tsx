import { OCDFGLayout } from './LayoutState';

interface ActivityGraph {
  successors: Map<string, Set<string>>;
  predecessors: Map<string, Set<string>>;
}

function collectActivityIds(layout: OCDFGLayout) {
  return Object.values(layout.nodes)
    .filter((node) => node.type === OCDFGLayout.ACTIVITY_TYPE)
    .map((node) => node.id);
}

function buildActivityGraph(layout: OCDFGLayout, activityIds: string[]): ActivityGraph {
  const activitySet = new Set(activityIds);
  const successors = new Map<string, Set<string>>();
  const predecessors = new Map<string, Set<string>>();

  activityIds.forEach((id) => {
    successors.set(id, new Set());
    predecessors.set(id, new Set());
  });

  Object.values(layout.edges).forEach((edge) => {
    if (!edge.original) return;
    if (!activitySet.has(edge.source) || !activitySet.has(edge.target)) return;
    successors.get(edge.source)?.add(edge.target);
    predecessors.get(edge.target)?.add(edge.source);
  });

  return { successors, predecessors };
}

function sortQueue(queue: string[], order: Map<string, number>) {
  queue.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

function computeLayers(
  layout: OCDFGLayout,
  activityIds: string[],
  graph: ActivityGraph,
) {
  const originalOrder = new Map<string, number>();
  activityIds.forEach((id, index) => originalOrder.set(id, index));

  const inDegree = new Map<string, number>();
  activityIds.forEach((id) => {
    inDegree.set(id, graph.predecessors.get(id)?.size ?? 0);
  });

  const queue: string[] = [];
  activityIds.forEach((id) => {
    if ((inDegree.get(id) ?? 0) === 0) {
      queue.push(id);
    }
  });

  const processed = new Set<string>();
  const layer = new Map<string, number>();

  while (processed.size < activityIds.length) {
    if (queue.length === 0) {
      const remaining = activityIds.filter((id) => !processed.has(id));
      if (remaining.length === 0) {
        break;
      }
      const fallback = remaining.reduce((best, candidate) => {
        if (!best) return candidate;
        const bestScore = originalOrder.get(best) ?? 0;
        const candidateScore = originalOrder.get(candidate) ?? 0;
        return candidateScore < bestScore ? candidate : best;
      }, '' as string);
      if (fallback) {
        queue.push(fallback);
        inDegree.set(fallback, 0);
      } else {
        break;
      }
    }

    sortQueue(queue, originalOrder);
    const current = queue.shift()!;
    if (processed.has(current)) {
      continue;
    }

    const predecessors = graph.predecessors.get(current);
    let layerValue = 0;
    if (predecessors && predecessors.size > 0) {
      layerValue = Math.max(
        ...Array.from(predecessors).map((pred) => (layer.get(pred) ?? 0) + 1),
      );
    }

    layer.set(current, layerValue);
    processed.add(current);

    graph.successors.get(current)?.forEach((succ) => {
      if (processed.has(succ)) {
        const candidate = layerValue + 1;
        if ((layer.get(succ) ?? 0) < candidate) {
          layer.set(succ, candidate);
        }
        return;
      }

      const candidateLayer = layerValue + 1;
      if ((layer.get(succ) ?? 0) < candidateLayer) {
        layer.set(succ, candidateLayer);
      }

      const remainingIn = (inDegree.get(succ) ?? 0) - 1;
      inDegree.set(succ, Math.max(0, remainingIn));
      if (remainingIn <= 0) {
        queue.push(succ);
      }
    });
  }

  activityIds.forEach((id) => {
    if (!layer.has(id)) {
      const predecessors = graph.predecessors.get(id);
      if (predecessors && predecessors.size > 0) {
        const candidate = Math.max(
          ...Array.from(predecessors).map((pred) => (layer.get(pred) ?? 0) + 1),
        );
        layer.set(id, candidate);
      } else {
        layer.set(id, 0);
      }
    }
  });

  return layer;
}

function buildLayering(
  layout: OCDFGLayout,
  activityIds: string[],
  layerMap: Map<string, number>,
) {
  const order = new Map<string, number>();
  activityIds.forEach((id, index) => order.set(id, index));

  const layering = new Map<number, string[]>();
  activityIds.forEach((id) => {
    const value = Math.max(0, Math.floor(layerMap.get(id) ?? 0));
    if (!layering.has(value)) {
      layering.set(value, []);
    }
    layering.get(value)!.push(id);
    if (layout.nodes[id]) {
      layout.nodes[id].layer = value;
    }
  });

  const sortedLayers = Array.from(layering.keys()).sort((a, b) => a - b);
  return sortedLayers.map((level) =>
    layering.get(level)!.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
  );
}

export async function assignLayers(layout: OCDFGLayout) {
  const activityIds = collectActivityIds(layout);
  if (activityIds.length === 0) {
    layout.updateLayering([]);
    return;
  }

  const graph = buildActivityGraph(layout, activityIds);
  const layers = computeLayers(layout, activityIds, graph);
  const layering = buildLayering(layout, activityIds, layers);
  layout.updateLayering(layering);
}
