/**
 * Strategies for arranging the object types (lanes) next to each other.
 */
import type { LaneOrder } from './types';

export interface LaneInput {
  types: string[];
  /** Activities per type with the number of events of that type there. */
  typeActivities: Map<string, Map<string, number>>;
  /** Object types per activity. */
  activityTypes: Map<string, string[]>;
  /** Arcs: endpoints given as activity ids or start/end ids (owner type). */
  arcs: Array<{ s: string; t: string; type: string; w: number }>;
  /** Type of a start/end node, undefined for activities. */
  terminalType: Map<string, string>;
  /** Number of objects per type (weight of the start arcs). */
  objects: Map<string, number>;
  /** Rank range of each type's activities in the global layering. */
  rankSpan: Map<string, { min: number; max: number }>;
  processAreas?: string[][];
  manual?: string[];
}

export interface LaneOrderResult {
  order: string[];
  note?: string;
}

const EXHAUSTIVE_LIMIT = 7;

export function orderLanes(strategy: LaneOrder, input: LaneInput): LaneOrderResult {
  const types = [...input.types].sort((a, b) => a.localeCompare(b));
  if (types.length <= 1) return { order: types };
  switch (strategy) {
    case 'alphabetical':
      return { order: types };
    case 'minSpan':
      return { order: minimise(types, spanCost(input)) };
    case 'similarity':
      return { order: bestPath(types, similarity(input)) };
    case 'centerLongest':
      return {
        order: centerOut(types, (t) => {
          const span = input.rankSpan.get(t);
          return (span ? span.max - span.min : 0) * 1000 + (input.typeActivities.get(t)?.size ?? 0);
        }),
      };
    case 'centerFrequent':
      return { order: centerOut(types, (t) => input.objects.get(t) ?? 0) };
    case 'centerHub':
      return {
        order: centerOut(types, (t) => {
          let shared = 0;
          input.typeActivities.get(t)?.forEach((_, a) => {
            if ((input.activityTypes.get(a)?.length ?? 0) > 1) shared++;
          });
          return shared;
        }),
      };
    case 'firstAppearance':
      return {
        order: [...types].sort(
          (a, b) =>
            (input.rankSpan.get(a)?.min ?? 0) - (input.rankSpan.get(b)?.min ?? 0) ||
            (input.rankSpan.get(a)?.max ?? 0) - (input.rankSpan.get(b)?.max ?? 0) ||
            a.localeCompare(b),
        ),
      };
    case 'processAreas': {
      if (!input.processAreas || input.processAreas.length === 0) {
        return {
          order: bestPath(types, similarity(input)),
          note: 'Process areas are only available for an event log — ordered by shared activities instead.',
        };
      }
      const order: string[] = [];
      for (const area of input.processAreas) {
        const members = area.filter((t) => types.includes(t) && !order.includes(t));
        // Inside an area, keep the types that share most next to each other.
        order.push(...(members.length > 2 ? bestPath(members, similarity(input)) : members));
      }
      types.filter((t) => !order.includes(t)).forEach((t) => order.push(t));
      return { order };
    }
    case 'manual': {
      const order = (input.manual ?? []).filter((t) => types.includes(t));
      types.filter((t) => !order.includes(t)).forEach((t) => order.push(t));
      return { order };
    }
    default:
      return { order: types };
  }
}

/**
 * Cost of a lane permutation: how far arcs have to leave their own lane to
 * reach shared activities. Nodes sit at the mean lane of their types.
 */
function spanCost(input: LaneInput) {
  // Aggregate arcs with identical signatures so the permutation search stays cheap.
  const sig = new Map<string, { s: string[]; t: string[]; type: string; w: number }>();
  const typesOf = (n: string) => {
    const term = input.terminalType.get(n);
    return term ? [term] : input.activityTypes.get(n) ?? [];
  };
  for (const a of input.arcs) {
    const s = typesOf(a.s);
    const t = typesOf(a.t);
    if (s.length <= 1 && t.length <= 1 && s[0] === a.type && t[0] === a.type) continue; // always 0
    const key = `${s.join('|')}#${t.join('|')}#${a.type}`;
    const entry = sig.get(key);
    const w = 1 + Math.log1p(a.w);
    if (entry) entry.w += w;
    else sig.set(key, { s, t, type: a.type, w });
  }
  const entries = [...sig.values()];
  return (order: string[]) => {
    const lane = new Map(order.map((t, i) => [t, i]));
    const pos = (ts: string[]) => ts.reduce((s, t) => s + lane.get(t)!, 0) / Math.max(1, ts.length);
    let cost = 0;
    for (const e of entries) {
      const own = lane.get(e.type)!;
      cost += e.w * (Math.abs(pos(e.s) - own) + Math.abs(pos(e.t) - own) + Math.abs(pos(e.s) - pos(e.t)));
    }
    return cost;
  };
}

function similarity(input: LaneInput) {
  return (a: string, b: string) => {
    const A = input.typeActivities.get(a);
    const B = input.typeActivities.get(b);
    if (!A || !B) return 0;
    let s = 0;
    A.forEach((wa, act) => {
      const wb = B.get(act);
      if (wb !== undefined) s += 1 + Math.log1p(Math.min(wa, wb));
    });
    return s;
  };
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const result: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    permutations(rest).forEach((p) => result.push([item, ...p]));
  });
  return result;
}

/** Minimise `cost` over permutations: exhaustive for few types, local search otherwise. */
export function minimise(types: string[], cost: (order: string[]) => number): string[] {
  if (types.length <= EXHAUSTIVE_LIMIT) {
    let best = types;
    let bestCost = cost(types);
    for (const p of permutations(types)) {
      const c = cost(p);
      if (c < bestCost - 1e-9) {
        best = p;
        bestCost = c;
      }
    }
    return best;
  }
  let order = [...types];
  let current = cost(order);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) {
        if (i === j) continue;
        const next = [...order];
        const [moved] = next.splice(i, 1);
        next.splice(j, 0, moved);
        const c = cost(next);
        if (c < current - 1e-9) {
          order = next;
          current = c;
          improved = true;
        }
      }
    }
  }
  return order;
}

/** Order maximising the similarity of neighbouring lanes. */
function bestPath(types: string[], sim: (a: string, b: string) => number): string[] {
  return minimise(types, (order) => {
    let s = 0;
    for (let i = 0; i + 1 < order.length; i++) s += sim(order[i], order[i + 1]);
    return -s;
  });
}

/** The highest-scoring type in the middle, the others alternately outwards. */
export function centerOut(types: string[], score: (t: string) => number): string[] {
  const sorted = [...types].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  const result: string[] = [];
  sorted.forEach((t, i) => {
    if (i % 2 === 0) result.push(t);
    else result.unshift(t);
  });
  return result;
}
