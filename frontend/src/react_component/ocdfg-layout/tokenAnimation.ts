/**
 * Token animation of the OC-DFG: every token is one object moving along its
 * object type's arc from one of its events to its next event, in real time.
 *
 * The steps come from `/api/new-ocdfg/flows/` (see `ocdfg_flows.py`); this
 * module decodes them and answers, for a moment in time, which tokens are on
 * which arc and where. Tokens only run on arcs the layout draws, so hidden
 * types, the legend sliders and hidden parallel arcs hide them too; start and
 * end arcs have no time of their own and carry no tokens.
 */
import type { LayoutResult, Pt } from './types';

/** Column-oriented payload of `/api/new-ocdfg/flows/`. */
export interface FlowsPayload {
  activities: string[];
  object_types: string[];
  objects: { type: number[]; variant_rank: number[] | null };
  flows: { object: number[]; source: number[]; target: number[]; start: number[]; duration: number[] };
  total_objects: number;
}

/**
 * Shortest time a step is shown for, in seconds. Only there so a step of 0 s
 * (two events at the same time) can be drawn at all, as in the handover
 * animation; it is not stretched beyond that.
 */
export const MIN_STEP_SECONDS = 1;

export interface Tokens {
  count: number;
  objectTypes: string[];
  /** Per step: its object, the index of its arc key and its time. */
  object: Int32Array;
  arc: Int32Array;
  start: Float64Array;
  /** Shown duration: the real one, at least MIN_STEP_SECONDS. */
  duration: Float64Array;
  /** Arc keys (`source→target@type`, the layout's arc ids) and their object type. */
  arcKeys: string[];
  arcType: Int32Array;
  /** Per object: its type and variant rank (0 = unknown). */
  objectType: Int32Array;
  objectRank: Int32Array | null;
  longest: number;
  timeline: { start: number; end: number };
}

export function arcKey(source: string, target: string, type: string): string {
  return `${source}→${target}@${type}`;
}

export function decodeFlows(payload: FlowsPayload): Tokens {
  const f = payload.flows;
  const count = f.object.length;
  const objectType = Int32Array.from(payload.objects.type);
  const objectRank = payload.objects.variant_rank ? Int32Array.from(payload.objects.variant_rank) : null;
  const object = Int32Array.from(f.object);
  const start = Float64Array.from(f.start);
  const duration = new Float64Array(count);
  const arc = new Int32Array(count);
  const keyIndex = new Map<string, number>();
  const arcKeys: string[] = [];
  const arcTypes: number[] = [];
  let longest = 0;
  let end = -Infinity;
  for (let i = 0; i < count; i++) {
    const type = objectType[object[i]];
    const key = arcKey(payload.activities[f.source[i]], payload.activities[f.target[i]], payload.object_types[type]);
    let k = keyIndex.get(key);
    if (k === undefined) {
      k = arcKeys.length;
      keyIndex.set(key, k);
      arcKeys.push(key);
      arcTypes.push(type);
    }
    arc[i] = k;
    const d = Math.max(MIN_STEP_SECONDS, f.duration[i]);
    duration[i] = d;
    if (d > longest) longest = d;
    if (start[i] + d > end) end = start[i] + d;
  }
  // The time window search needs the steps sorted by start time. The backend
  // sends them sorted; sort here only if that ever changes.
  let sorted = true;
  for (let i = 1; i < count && sorted; i++) sorted = start[i] >= start[i - 1];
  if (!sorted) {
    const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => start[a] - start[b]);
    const permute = <T extends Int32Array | Float64Array>(src: T): T => {
      const out = new (src.constructor as { new (n: number): T })(count);
      order.forEach((from, to) => (out[to] = src[from]));
      return out;
    };
    return {
      ...tokensFrom(payload, permute(object), permute(arc), permute(start), permute(duration)),
      arcKeys,
      arcType: Int32Array.from(arcTypes),
      objectType,
      objectRank,
      longest,
      timeline: { start: start[order[0]], end },
    };
  }
  return {
    ...tokensFrom(payload, object, arc, start, duration),
    arcKeys,
    arcType: Int32Array.from(arcTypes),
    objectType,
    objectRank,
    longest,
    timeline: count > 0 ? { start: start[0], end } : { start: 0, end: 0 },
  };
}

function tokensFrom(payload: FlowsPayload, object: Int32Array, arc: Int32Array, start: Float64Array, duration: Float64Array) {
  return { count: object.length, objectTypes: payload.object_types, object, arc, start, duration };
}

/** A drawn path with its cumulative lengths, for fast positions along it. */
export interface TokenPath {
  points: Pt[];
  cumulative: number[];
}

function toPath(points: Pt[]): TokenPath {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    cumulative.push(cumulative[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { points, cumulative };
}

/** Point at fraction `t` (0..1) of the path's length. */
export function pointOnPath(path: TokenPath, t: number): Pt {
  const { points, cumulative } = path;
  if (points.length === 1) return points[0];
  const total = cumulative[cumulative.length - 1];
  const target = Math.min(1, Math.max(0, t)) * total;
  let lo = 1;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const a = points[lo - 1];
  const b = points[lo];
  const seg = cumulative[lo] - cumulative[lo - 1];
  const u = seg > 0 ? (target - cumulative[lo - 1]) / seg : 0;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

/**
 * The path a token takes on every drawn arc, by arc id: the arc itself plus
 * the merge trunks it shares at its source and target (merge points), and
 * the loop of every drawn self loop (a badge has just its centre).
 */
export function arcPaths(result: LayoutResult): Map<string, TokenPath> {
  const outgoing = new Map<string, Pt[]>();
  const incoming = new Map<string, Pt[]>();
  for (const trunk of result.trunks) {
    // An incoming trunk ends at its node (and carries the arrow head).
    for (const id of trunk.arcs) (trunk.arrow ? incoming : outgoing).set(id, trunk.points);
  }
  const paths = new Map<string, TokenPath>();
  for (const a of result.arcs) {
    if (a.points.length === 0) continue;
    paths.set(a.id, toPath([...(outgoing.get(a.id) ?? []), ...a.points, ...(incoming.get(a.id) ?? [])]));
  }
  for (const s of result.selfLoops) {
    paths.set(arcKey(s.node, s.node, s.type), toPath(s.points.length > 0 ? s.points : [s.center]));
  }
  return paths;
}

export interface TokenDot {
  x: number;
  y: number;
  type: string;
}

/**
 * The tokens on the road at `time`: every step with start ≤ time < start +
 * duration whose arc is drawn and whose object passes `showObject`.
 */
export function tokensAt(
  tokens: Tokens,
  pathByArc: Array<TokenPath | null>,
  time: number,
  showObject: (object: number) => boolean = () => true,
): TokenDot[] {
  const dots: TokenDot[] = [];
  const { start, duration } = tokens;
  // Only steps that started within `longest` before `time` can still run.
  let lo = 0;
  let hi = tokens.count;
  const from = time - tokens.longest;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (start[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < tokens.count && start[i] <= time; i++) {
    const d = duration[i];
    if (time >= start[i] + d) continue;
    const path = pathByArc[tokens.arc[i]];
    if (!path) continue;
    const object = tokens.object[i];
    if (!showObject(object)) continue;
    const p = pointOnPath(path, (time - start[i]) / d);
    dots.push({ x: p.x, y: p.y, type: tokens.objectTypes[tokens.objectType[object]] });
  }
  return dots;
}
