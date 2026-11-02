/**
 * Conversion of the backend OC-DFG payload into the lab's graph model, and
 * the data filters (hidden types, variant coverage) applied before layout.
 */
import type { LabArc, LabGraph, LabNode } from './types';

/** Node/link shape of `/api/new-ocdfg/` (networkx node_link_data). */
export interface BackendDfg {
  nodes: Array<{
    id: string;
    label?: string;
    types?: string[];
    role?: string | null;
    object_type?: string | null;
    metrics?: { frequency?: number } | null;
  }>;
  links: Array<{
    source: string;
    target: string;
    key?: string;
    objtype?: string;
    weight?: number;
    variant_rank?: number;
    metrics?: { frequency?: number; avg_lead_time?: number | null } | null;
  }>;
}

export function fromBackendDfg(dfg: BackendDfg, variantCounts?: Record<string, number>): LabGraph {
  const nodes: LabNode[] = [];
  const typeSet = new Set<string>();
  for (const n of dfg.nodes ?? []) {
    const role = n.role === 'start' || n.role === 'end' ? n.role : null;
    const types = role && n.object_type ? [n.object_type] : [...(n.types ?? [])];
    types.forEach((t) => typeSet.add(t));
    nodes.push({
      id: String(n.id),
      label: role ? String(n.object_type ?? n.label ?? n.id) : String(n.label ?? n.id),
      kind: role === 'start' ? 'start' : role === 'end' ? 'end' : 'activity',
      types,
      frequency: n.metrics?.frequency ?? 0,
    });
  }
  const arcs: LabArc[] = [];
  const seen = new Set<string>();
  for (const l of dfg.links ?? []) {
    const type = l.key ?? l.objtype;
    if (!type) continue;
    typeSet.add(type);
    const id = `${l.source}→${l.target}@${type}`;
    if (seen.has(id)) continue;
    seen.add(id);
    arcs.push({
      id,
      source: String(l.source),
      target: String(l.target),
      type,
      weight: l.weight ?? l.metrics?.frequency ?? 1,
      variantRank: l.variant_rank,
      avgLeadTime: l.metrics?.avg_lead_time ?? null,
    });
  }
  return { nodes, arcs, types: [...typeSet].sort((a, b) => a.localeCompare(b)), variantCounts };
}

/**
 * Build a lab graph from traces per object type. Used for the built-in
 * examples and the tests: every trace is one object's activity sequence.
 */
export function fromTraces(traces: Record<string, Array<[string[], number]>>): LabGraph {
  const nodes = new Map<string, LabNode>();
  const arcMap = new Map<string, LabArc>();
  const variantCounts: Record<string, number> = {};
  const addArc = (source: string, target: string, type: string, w: number, rank: number) => {
    const id = `${source}→${target}@${type}`;
    const existing = arcMap.get(id);
    if (existing) {
      existing.weight += w;
      existing.variantRank = Math.min(existing.variantRank ?? rank, rank);
    } else {
      arcMap.set(id, { id, source, target, type, weight: w, variantRank: rank });
    }
  };
  for (const [type, variants] of Object.entries(traces)) {
    variantCounts[type] = variants.length;
    const startId = `__start__:${type}`;
    const endId = `__end__:${type}`;
    nodes.set(startId, { id: startId, label: type, kind: 'start', types: [type], frequency: 0 });
    nodes.set(endId, { id: endId, label: type, kind: 'end', types: [type], frequency: 0 });
    const sorted = [...variants].sort((a, b) => b[1] - a[1]);
    sorted.forEach(([trace, count], index) => {
      const rank = index + 1;
      nodes.get(startId)!.frequency += count;
      nodes.get(endId)!.frequency += count;
      let prev = startId;
      for (const act of trace) {
        const node = nodes.get(act) ?? { id: act, label: act, kind: 'activity' as const, types: [], frequency: 0 };
        if (!node.types.includes(type)) node.types.push(type);
        node.frequency += count;
        nodes.set(act, node);
        addArc(prev, act, type, count, rank);
        prev = act;
      }
      addArc(prev, endId, type, count, rank);
    });
  }
  for (const n of nodes.values()) n.types.sort();
  return {
    nodes: [...nodes.values()],
    arcs: [...arcMap.values()],
    types: Object.keys(traces).sort((a, b) => a.localeCompare(b)),
    variantCounts,
  };
}

/**
 * Apply hidden types and the variant coverage, then drop nodes that lost all
 * their arcs. Returns a new graph.
 */
export function filterGraph(graph: LabGraph, hiddenTypes: string[], coverage: number, arcThreshold = 0): LabGraph {
  const hidden = new Set(hiddenTypes);
  const types = graph.types.filter((t) => !hidden.has(t));
  const limit = (type: string) => {
    const total = graph.variantCounts?.[type];
    if (!total || coverage >= 1) return Infinity;
    return Math.max(1, Math.ceil(total * Math.max(0, coverage)));
  };
  const maxWeight = new Map<string, number>();
  for (const a of graph.arcs) maxWeight.set(a.type, Math.max(maxWeight.get(a.type) ?? 0, a.weight));
  const arcs = graph.arcs.filter(
    (a) =>
      !hidden.has(a.type) &&
      (a.variantRank === undefined || a.variantRank <= limit(a.type)) &&
      a.weight >= arcThreshold * (maxWeight.get(a.type) ?? 0),
  );
  const used = new Set<string>();
  arcs.forEach((a) => {
    used.add(a.source);
    used.add(a.target);
  });
  const nodes = graph.nodes
    .filter((n) => used.has(n.id))
    .map((n) => ({ ...n, types: n.types.filter((t) => !hidden.has(t)) }))
    .filter((n) => n.types.length > 0);
  const nodeIds = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    arcs: arcs.filter((a) => nodeIds.has(a.source) && nodeIds.has(a.target)),
    types: types.filter((t) => arcs.some((a) => a.type === t)),
    variantCounts: graph.variantCounts,
  };
}
