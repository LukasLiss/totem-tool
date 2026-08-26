/**
 * Derived render data shared by the OCCN editor and the read-only discovery
 * visualizer (react_component/OCCNVisualizer): both feed the results into
 * OccnRenderContext, so the computation must live in one place.
 */

type EdgeLike = {
  id: string;
  source: string;
  target: string;
  data?: { objectType?: string };
};

/**
 * Signed perpendicular offset per arc id so parallel arcs of the multigraph
 * (one per object type between the same activities) fan out instead of
 * overlapping. Self-loops (absent in the editor, present in discovered nets)
 * stack upwards with non-negative offsets instead of the centered fan.
 */
export function computeParallelOffsets(edges: EdgeLike[]): Record<string, number> {
  const pairs = new Map<string, EdgeLike[]>();
  for (const edge of edges) {
    const key = [edge.source, edge.target].sort().join(' ');
    const list = pairs.get(key);
    if (list) list.push(edge);
    else pairs.set(key, [edge]);
  }
  const result: Record<string, number> = {};
  for (const list of pairs.values()) {
    const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
    sorted.forEach((edge, index) => {
      if (edge.source === edge.target) {
        result[edge.id] = index * 42;
        return;
      }
      let offset = (index - (sorted.length - 1) / 2) * 42;
      // Canonical perpendicular direction per unordered node pair, so
      // opposite-direction arcs fan out consistently.
      if (edge.source > edge.target) offset = -offset;
      result[edge.id] = offset;
    });
  }
  return result;
}

/**
 * Object types incident to each activity (for the striped node fills),
 * ordered by `typeOrder` (the model's object-type list).
 */
export function computeIncidentTypes(
  edges: EdgeLike[],
  typeOrder: string[],
): Record<string, string[]> {
  const order = new Map(typeOrder.map((name, i) => [name, i]));
  // Null prototype: keys are activity names (user data, e.g. "__proto__").
  const sets: Record<string, Set<string>> = Object.create(null);
  for (const edge of edges) {
    const ot = edge.data?.objectType;
    if (!ot) continue;
    (sets[edge.source] ??= new Set()).add(ot);
    (sets[edge.target] ??= new Set()).add(ot);
  }
  const result: Record<string, string[]> = Object.create(null);
  for (const [name, set] of Object.entries(sets)) {
    result[name] = [...set].sort(
      (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99),
    );
  }
  return result;
}
