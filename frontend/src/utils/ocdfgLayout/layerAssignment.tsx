import glpkModule, { type GLPK } from 'glpk.js';
import { OCDFGLayout, type LayoutConfig } from './LayoutState';

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
 
function assignLayersHeuristic(layout: OCDFGLayout) {
  const activityIds = collectActivityIds(layout);
  if (activityIds.length === 0) {
    return [] as string[][];
  }

  const graph = buildActivityGraph(layout, activityIds);
  const layers = computeLayers(activityIds, graph);
  return buildLayering(layout, activityIds, layers);
}

interface LayeringArc {
  source: string;
  target: string;
  reversed: boolean;
}

let glpkInstancePromise: Promise<GLPK> | null = null;

function getGlpkInstance() {
  if (!glpkInstancePromise) {
    glpkInstancePromise = glpkModule();
  }
  return glpkInstancePromise;
}

function createIlpObjective(arcs: LayeringArc[]) {
  const vars = arcs.flatMap((arc) => ([
    { name: arc.target, coef: 1 },
    { name: arc.source, coef: -1 },
  ]));
  const coefficients = new Map<string, number>();
  vars.forEach(({ name, coef }) => {
    coefficients.set(name, (coefficients.get(name) ?? 0) + coef);
  });
  return Array.from(coefficients.entries()).map(([name, coef]) => ({ name, coef }));
}

function createArcSpanConstraints(arcs: LayeringArc[], glpk: GLPK) {
  return arcs.map((arc) => ({
    name: `edge_span_${arc.source}_${arc.target}`,
    vars: [
      { name: arc.target, coef: 1 },
      { name: arc.source, coef: -1 },
    ],
    bnds: { type: glpk.GLP_LO, lb: 1, ub: Infinity },
  }));
}

function createPositiveLayerConstraints(vertices: string[], glpk: GLPK) {
  return vertices.map((vertex) => ({
    name: `positive_layer_${vertex}`,
    vars: [{ name: vertex, coef: 1 }],
    bnds: { type: glpk.GLP_LO, lb: 0, ub: Infinity },
  }));
}

function collectLayeringFromSolution(solution: Record<string, number>) {
  const layering = new Map<number, string[]>();
  Object.entries(solution).forEach(([vertex, value]) => {
    const layerIndex = Math.max(0, Math.floor(value));
    if (!layering.has(layerIndex)) {
      layering.set(layerIndex, []);
    }
    layering.get(layerIndex)!.push(vertex);
  });
  const sortedLayers = Array.from(layering.keys()).sort((a, b) => a - b);
  return sortedLayers.map((idx) => layering.get(idx) ?? []);
}

async function assignLayersWithIlp(layout: OCDFGLayout) {
  const glpk = await getGlpkInstance();
  const vertices = Object.values(layout.nodes)
    .filter((node) => node.type === OCDFGLayout.ACTIVITY_TYPE)
    .map((node) => node.id);

  if (vertices.length === 0) {
    return [] as string[][];
  }

  const arcs: LayeringArc[] = Object.values(layout.edges)
    .filter((edge) => edge.original)
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      reversed: edge.reversed,
    }))
    .filter((arc) => vertices.includes(arc.source) && vertices.includes(arc.target))
    .filter((arc) => arc.source !== arc.target);

  if (arcs.length === 0) {
    return [vertices];
  }

  const objectiveVars = createIlpObjective(arcs);
  const constraints = [
    ...createArcSpanConstraints(arcs, glpk),
    ...createPositiveLayerConstraints(vertices, glpk),
  ];

  const lp = {
    name: 'ocdfg-layering',
    objective: {
      direction: glpk.GLP_MIN,
      name: 'min_total_span',
      vars: objectiveVars,
    },
    subjectTo: constraints,
    integers: vertices,
  };

  let result;
  try {
    result = glpk.solve(lp, { msglev: glpk.GLP_MSG_OFF });
  } catch (error) {
    console.warn('[OCDFG] GLPK solve failed, falling back to heuristic.', error);
    return null;
  }
  const status = result?.result?.status;
  if (status !== glpk.GLP_OPT && status !== glpk.GLP_FEAS) {
    return null;
  }

  const vars = result.result?.vars as Record<string, number> | undefined;
  if (!vars) {
    return null;
  }

  return collectLayeringFromSolution(vars);
}

export async function assignLayers(layout: OCDFGLayout, config: LayoutConfig) {
  const strategy = config.layeringStrategy ?? 'auto';
  if (strategy !== 'heuristic') {
    try {
      const ilpLayering = await assignLayersWithIlp(layout);
      if (ilpLayering) {
        layout.updateLayering(ilpLayering);
        return;
      }
      if (strategy === 'ilp') {
        throw new Error('ILP layering failed to produce a solution');
      }
    } catch (error) {
      if (strategy === 'ilp') {
        throw error;
      }
      console.warn('[OCDFG] ILP layering failed, falling back to heuristic.', error);
    }
  }

  const layering = assignLayersHeuristic(layout);
  layout.updateLayering(layering);
}
