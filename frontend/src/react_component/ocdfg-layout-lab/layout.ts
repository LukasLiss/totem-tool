/**
 * The layout pipeline of the OC-DFG Layout Lab.
 *
 *  1. Main flow per object type: an order of the type's nodes (see flow.ts),
 *     optionally derived from its block structure (blocks.ts). Arcs pointing
 *     backwards are loops, arcs between parallel branches "interleave".
 *  2. Global ranks: the forward arcs of all types form a graph; a weighted
 *     feedback arc set removes conflicts between types, then it is layered.
 *  3. Lanes: the object types get an order (lanes.ts) and a column each.
 *     Inside a lane, choice/parallel branches and loop redo parts get side
 *     offsets from the block tree.
 *  4. Cross placement per rank by isotonic regression (no overlaps, minimal
 *     displacement), with dummy items for long arcs and loop channels so arcs
 *     never run through nodes.
 *  5. Ports, channel tracks and the routes themselves, then highways,
 *     merge points and self loops.
 *  6. Flow space → screen, metrics.
 */
import {
  blockExtents,
  blockPaths,
  describeBlock,
  detectBlocks,
  fromProcessTree,
  isInterleave,
  linearize,
  orderFlowers,
  type Extents,
} from './blocks';
import { bfsOrder, dfsOrder, greedyFasOrder, springRankOrder, type WArc } from './flow';
import {
  catmullRom,
  clipToRect,
  cubic,
  dist,
  flowCurve,
  offsetPolyline,
  pointAt,
  quadratic,
  resample,
  roundCorners,
  simplify,
} from './geometry';
import { filterGraph } from './graph';
import { orderLanes } from './lanes';
import { measure, type MetricArc } from './metrics';
import type {
  ArcClass,
  Block,
  LabArc,
  LabGraph,
  LabNode,
  LayoutExtras,
  LayoutOptions,
  LayoutResult,
  PlacedNode,
  Pt,
  RoutedArc,
  SelfLoop,
  Side,
  Trunk,
  TypeSummary,
} from './types';

const CHAR_W = 6.4;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface Item {
  key: string;
  rank: number;
  size: number;
  desired: number;
  base: number;
  x: number;
  w: number;
  tie: number;
  node?: LabNode;
  group?: Group;
  channel?: boolean;
}

interface Group {
  id: string;
  s: string;
  t: string;
  members: LabArc[];
  widths: number[];
  offsets: number[];
  cls: ArcClass;
  corridor: number;
  side: 1 | -1;
  lane: number;
  weight: number;
  chain: Item[];
  channelItems: Item[];
  channelX: number;
  srcSide: Side | null;
  tgtSide: Side | null;
  srcPos: number;
  tgtPos: number;
  srcPt: Pt;
  tgtPt: Pt;
  srcN: Pt;
  tgtN: Pt;
  /** Merge-point junctions replacing the port as route endpoint. */
  srcJ?: Pt;
  tgtJ?: Pt;
  ctrl: Pt[];
  center: Pt[];
}

interface Attach {
  g: Group;
  node: string;
  side: Side;
  isSource: boolean;
  key: number;
}

interface Segment {
  g: Group;
  channel: number;
  from: number;
  to: number;
  track: number;
  y: number;
}

export function computeLayout(graph: LabGraph, options: LayoutOptions, extras: LayoutExtras = {}): LayoutResult {
  const started = now();
  const opts = options;
  const notes: string[] = [];
  const g = filterGraph(graph, opts.hiddenTypes, opts.variantCoverage, opts.arcThreshold);
  if (g.nodes.length === 0) return emptyResult(notes, started);

  const horizontal = opts.direction === 'LR' || opts.direction === 'RL';
  const nodeById = new Map(g.nodes.map((n) => [n.id, n]));
  const types = g.types;
  const startOf = new Map<string, string>();
  const endOf = new Map<string, string>();
  const terminalType = new Map<string, string>();
  for (const n of g.nodes) {
    if (n.kind === 'start') startOf.set(n.types[0], n.id);
    if (n.kind === 'end') endOf.set(n.types[0], n.id);
    if (n.kind !== 'activity') terminalType.set(n.id, n.types[0]);
  }
  const selfArcs = g.arcs.filter((a) => a.source === a.target);
  const arcs = g.arcs.filter((a) => a.source !== a.target);

  // Events per (activity, type): every event has exactly one predecessor per object.
  const typeFreq = new Map<string, Map<string, number>>();
  for (const a of g.arcs) {
    if (nodeById.get(a.target)?.kind !== 'activity') continue;
    const m = typeFreq.get(a.target) ?? new Map<string, number>();
    m.set(a.type, (m.get(a.type) ?? 0) + a.weight);
    typeFreq.set(a.target, m);
  }

  // ------------------------------------------------------------------
  // 1. Main flow per object type
  // ------------------------------------------------------------------
  const blocks = new Map<string, Block | null>();
  const typedClass = new Map<string, 'forward' | 'back' | 'interleave'>();
  let imMissing = false;
  for (const t of types) {
    const tArcs = arcs.filter((a) => a.type === t);
    const acts = g.nodes.filter((n) => n.kind === 'activity' && n.types.includes(t)).map((n) => n.id);
    const actSet = new Set(acts);
    const actArcs = tArcs.filter((a) => actSet.has(a.source) && actSet.has(a.target));
    const starts = new Map<string, number>();
    const ends = new Map<string, number>();
    for (const a of tArcs) {
      if (nodeById.get(a.source)?.kind === 'start') starts.set(a.target, (starts.get(a.target) ?? 0) + a.weight);
      if (nodeById.get(a.target)?.kind === 'end') ends.set(a.source, (ends.get(a.source) ?? 0) + a.weight);
    }
    let block: Block | null = null;
    if (acts.length > 0 && opts.blockDetection !== 'none') {
      const tree = opts.blockDetection === 'im' ? extras.imTrees?.[t] : undefined;
      const sub = { acts, arcs: actArcs.map((a) => ({ s: a.source, t: a.target, w: a.weight })), starts, ends };
      if (tree) block = orderFlowers(fromProcessTree(tree, actSet), sub);
      else {
        if (opts.blockDetection === 'im') imMissing = true;
        block = detectBlocks(sub, opts.blockNoise);
      }
    }
    blocks.set(t, block);

    const interleave = new Set<string>();
    if (block) {
      const paths = blockPaths(block);
      for (const a of actArcs) if (isInterleave(paths, a.source, a.target)) interleave.add(a.id);
    }
    const first = startOf.has(t) ? [startOf.get(t)!] : [];
    const last = endOf.has(t) ? [endOf.get(t)!] : [];
    const nodes = [...first, ...acts, ...last];
    const flowArcs: WArc[] = tArcs.filter((a) => !interleave.has(a.id)).map((a) => ({ s: a.source, t: a.target, w: a.weight }));
    const input = { nodes, arcs: flowArcs, first, last };
    let order: string[];
    const method = opts.flowMethod === 'blocks' && !block ? 'greedyFas' : opts.flowMethod;
    if (method === 'blocks') order = [...first, ...linearize(block!), ...last];
    else if (method === 'dfs') order = dfsOrder(input);
    else if (method === 'springRank') order = springRankOrder(input);
    else if (method === 'bfs') order = bfsOrder(input);
    else order = greedyFasOrder(input);
    const idx = new Map(order.map((n, i) => [n, i]));
    for (const a of tArcs) {
      if (interleave.has(a.id)) typedClass.set(a.id, 'interleave');
      else typedClass.set(a.id, (idx.get(a.target) ?? 0) > (idx.get(a.source) ?? 0) ? 'forward' : 'back');
    }
  }
  if (imMissing) notes.push('Inductive-miner trees are not loaded — using the light cut detection.');

  // ------------------------------------------------------------------
  // 2. Global ranks
  // ------------------------------------------------------------------
  const agg = new Map<string, WArc>();
  for (const a of arcs) {
    if (typedClass.get(a.id) !== 'forward') continue;
    const k = `${a.source}\u0001${a.target}`;
    const e = agg.get(k);
    if (e) e.w += a.weight;
    else agg.set(k, { s: a.source, t: a.target, w: a.weight });
  }
  const startIds = g.nodes.filter((n) => n.kind === 'start').map((n) => n.id);
  const endIds = g.nodes.filter((n) => n.kind === 'end').map((n) => n.id);
  const globalOrder = greedyFasOrder({
    nodes: g.nodes.map((n) => n.id),
    arcs: [...agg.values()],
    first: startIds,
    last: endIds,
  });
  const gIdx = new Map(globalOrder.map((n, i) => [n, i]));
  const dag = [...agg.values()].filter((a) => gIdx.get(a.t)! > gIdx.get(a.s)!);
  const rank = layer(g.nodes, globalOrder, dag, opts);

  const maxRank = Math.max(0, ...rank.values());
  const rankSpan = new Map<string, { min: number; max: number }>();
  for (const n of g.nodes) {
    if (n.kind !== 'activity') continue;
    for (const t of n.types) {
      const r = rank.get(n.id)!;
      const span = rankSpan.get(t) ?? { min: r, max: r };
      span.min = Math.min(span.min, r);
      span.max = Math.max(span.max, r);
      rankSpan.set(t, span);
    }
  }

  // ------------------------------------------------------------------
  // 3. Lanes
  // ------------------------------------------------------------------
  const typeActivities = new Map<string, Map<string, number>>();
  const activityTypes = new Map<string, string[]>();
  for (const n of g.nodes) {
    if (n.kind !== 'activity') continue;
    activityTypes.set(n.id, n.types);
    for (const t of n.types) {
      const m = typeActivities.get(t) ?? new Map<string, number>();
      m.set(n.id, typeFreq.get(n.id)?.get(t) ?? 1);
      typeActivities.set(t, m);
    }
  }
  const objects = new Map<string, number>();
  for (const a of arcs) if (nodeById.get(a.source)?.kind === 'start') objects.set(a.type, (objects.get(a.type) ?? 0) + a.weight);
  const laneResult = orderLanes(opts.laneOrder, {
    types,
    typeActivities,
    activityTypes,
    arcs: arcs.map((a) => ({ s: a.source, t: a.target, type: a.type, w: a.weight })),
    terminalType,
    objects,
    rankSpan,
    processAreas: extras.processAreas,
    manual: opts.manualLaneOrder,
  });
  if (laneResult.note) notes.push(laneResult.note);
  const laneOrder = laneResult.order;
  const laneIdx = new Map(laneOrder.map((t, i) => [t, i]));
  const nLanes = laneOrder.length;
  const sideOf = (t: string): 1 | -1 => {
    const i = laneIdx.get(t) ?? 0;
    const leftHalf = nLanes > 1 && i < (nLanes - 1) / 2;
    switch (opts.loopSide) {
      case 'left':
        return -1;
      case 'outer':
        return leftHalf ? -1 : 1;
      case 'inner':
        return leftHalf ? 1 : -1;
      default:
        return 1;
    }
  };

  // Node sizes: screen size, then flow-space size (cross × flow).
  const screenSize = new Map<string, { w: number; h: number }>();
  for (const n of g.nodes) screenSize.set(n.id, nodeScreenSize(n, opts, horizontal));
  const crossSize = (id: string) => (horizontal ? screenSize.get(id)!.h : screenSize.get(id)!.w);
  const flowSize = (id: string) => (horizontal ? screenSize.get(id)!.w : screenSize.get(id)!.h);
  const actIds = g.nodes.filter((n) => n.kind === 'activity').map((n) => n.id);
  const meanCross = actIds.length ? actIds.reduce((s, id) => s + crossSize(id), 0) / actIds.length : 120;
  const U = meanCross + opts.nodeGap;

  const useBlockOffsets = opts.crossPlacement !== 'sugiyama' && opts.branchPlacement !== 'none';
  const extents = new Map<string, Extents>();
  for (const t of laneOrder) {
    const block = blocks.get(t);
    const acts = [...(typeActivities.get(t)?.keys() ?? [])];
    let ext: Extents;
    if (block && useBlockOffsets) ext = blockExtents(block, opts.branchPlacement, sideOf(t));
    else ext = { left: 0.5, right: 0.5, offsets: new Map(acts.map((a) => [a, 0])) };
    ext.left = Math.max(ext.left, 0.5);
    ext.right = Math.max(ext.right, 0.5);
    extents.set(t, ext);
  }
  const laneCenter = new Map<string, number>();
  let cursor = 0;
  for (const t of laneOrder) {
    const ext = extents.get(t)!;
    const c = cursor + ext.left * U;
    laneCenter.set(t, c);
    cursor = c + ext.right * U + opts.laneGap;
  }

  // Desired cross position of every node.
  const desired = new Map<string, number>();
  for (const n of g.nodes) {
    if (n.kind !== 'activity') {
      desired.set(n.id, laneCenter.get(n.types[0]) ?? 0);
      continue;
    }
    const pos = n.types
      .filter((t) => laneCenter.has(t))
      .map((t) => ({ t, x: laneCenter.get(t)! + (extents.get(t)!.offsets.get(n.id) ?? 0) * U }));
    if (pos.length === 0) {
      desired.set(n.id, 0);
      continue;
    }
    if (opts.sharedPlacement === 'dominant') {
      const freq = typeFreq.get(n.id);
      pos.sort((a, b) => (freq?.get(b.t) ?? 0) - (freq?.get(a.t) ?? 0) || laneIdx.get(a.t)! - laneIdx.get(b.t)!);
      desired.set(n.id, pos[0].x);
    } else if (opts.sharedPlacement === 'median') {
      const xs = pos.map((p) => p.x).sort((a, b) => a - b);
      const m = xs.length >> 1;
      desired.set(n.id, xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2);
    } else {
      desired.set(n.id, pos.reduce((s, p) => s + p.x, 0) / pos.length);
    }
  }
  if (opts.terminalPlacement === 'adjacent') {
    for (const n of g.nodes) {
      if (n.kind === 'activity') continue;
      const nb = arcs.filter((a) => (n.kind === 'start' ? a.source === n.id : a.target === n.id));
      const tw = nb.reduce((s, a) => s + a.weight, 0);
      if (tw > 0) {
        desired.set(
          n.id,
          nb.reduce((s, a) => s + a.weight * desired.get(n.kind === 'start' ? a.target : a.source)!, 0) / tw,
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Arc widths and groups
  // ------------------------------------------------------------------
  const widthOf = makeWidthScale(g.arcs, opts);
  const mergePoints = opts.mergePoints && opts.portMode !== 'center';
  const bundling = mergePoints ? 'separate' : opts.bundling;
  if (opts.mergePoints && opts.bundling !== 'separate' && opts.portMode !== 'center') {
    notes.push('Merge points join arcs per object type, so arcs are not bundled into highways.');
  }
  const groupMap = new Map<string, Group>();
  for (const a of arcs) {
    const tc = typedClass.get(a.id)!;
    if (tc === 'interleave' && opts.parallelArcs === 'hidden') continue;
    const rs = rank.get(a.source)!;
    const rt = rank.get(a.target)!;
    const cls: ArcClass = tc === 'interleave' ? 'interleave' : rt > rs ? 'forward' : rt < rs ? 'back' : 'flat';
    const key = bundling === 'separate' ? a.id : `${a.source}\u0001${a.target}\u0001${cls}`;
    let grp = groupMap.get(key);
    if (!grp) {
      grp = {
        id: key,
        s: a.source,
        t: a.target,
        members: [],
        widths: [],
        offsets: [],
        cls,
        corridor: 0,
        side: 1,
        lane: 0,
        weight: 0,
        chain: [],
        channelItems: [],
        channelX: 0,
        srcSide: null,
        tgtSide: null,
        srcPos: 0,
        tgtPos: 0,
        srcPt: { x: 0, y: 0 },
        tgtPt: { x: 0, y: 0 },
        srcN: { x: 0, y: 1 },
        tgtN: { x: 0, y: -1 },
        ctrl: [],
        center: [],
      };
      groupMap.set(key, grp);
    }
    grp.members.push(a);
  }
  const groups = [...groupMap.values()];
  const bandGap = Math.max(1, opts.trackGap * 0.4);
  for (const grp of groups) {
    grp.members.sort((a, b) => (laneIdx.get(a.type) ?? 0) - (laneIdx.get(b.type) ?? 0));
    grp.widths = grp.members.map((a) => widthOf(a.weight, a.type));
    grp.weight = grp.members.reduce((s, a) => s + a.weight, 0);
    grp.lane = laneIdx.get(grp.members[0].type) ?? 0;
    grp.side = sideOf(grp.members[0].type);
    const n = grp.members.length;
    if (n === 1 || bundling === 'merged') {
      grp.corridor = n === 1 ? grp.widths[0] : mergedWidth(grp.widths, opts);
      grp.offsets = grp.members.map(() => 0);
    } else {
      const gap = bundling === 'fanned' ? opts.trackGap * 2.5 : bandGap;
      const total = grp.widths.reduce((s, w) => s + w, 0) + gap * (n - 1);
      let c = -total / 2;
      grp.offsets = grp.widths.map((w) => {
        const o = c + w / 2;
        c += w + gap;
        // Lanes increase with the cross coordinate; the right-hand normal of
        // a downward route points to lower cross values, hence the minus.
        return -o;
      });
      grp.corridor = bundling === 'fanned' ? Math.max(...grp.widths) + bandGap * (n - 1) : total;
    }
  }

  // ------------------------------------------------------------------
  // 4. Cross placement
  // ------------------------------------------------------------------
  const nRanks = maxRank + 1;
  const ranks: Item[][] = Array.from({ length: nRanks }, () => []);
  const nodeItem = new Map<string, Item>();
  let tie = 0;
  for (const n of [...g.nodes].sort((a, b) => desired.get(a.id)! - desired.get(b.id)!)) {
    const it: Item = {
      key: n.id,
      rank: rank.get(n.id)!,
      size: crossSize(n.id),
      desired: desired.get(n.id)!,
      base: desired.get(n.id)!,
      x: desired.get(n.id)!,
      w: 10,
      tie: tie++,
      node: n,
    };
    nodeItem.set(n.id, it);
    ranks[it.rank].push(it);
  }
  const drawStraight = opts.edgeStyle === 'straight';
  const sideChannel = opts.backArcStyle === 'sideChannel';
  for (const grp of groups) {
    const rs = rank.get(grp.s)!;
    const rt = rank.get(grp.t)!;
    const mk = (r: number, channel: boolean): Item => {
      const it: Item = {
        key: `${grp.id}#${r}${channel ? 'c' : ''}`,
        rank: r,
        size: Math.max(2, grp.corridor),
        desired: 0,
        base: 0,
        x: 0,
        w: channel ? 2 : 1,
        tie: tie++,
        group: grp,
        channel,
      };
      ranks[r].push(it);
      return it;
    };
    if (grp.cls === 'forward' && !drawStraight) {
      for (let r = rs + 1; r < rt; r++) grp.chain.push(mk(r, false));
    } else if (grp.cls === 'back' && !sideChannel && opts.backArcStyle === 'reversed' && !drawStraight) {
      for (let r = rs - 1; r > rt; r--) grp.chain.push(mk(r, false));
    } else if (grp.cls === 'back' && sideChannel) {
      for (let r = rt; r <= rs; r++) grp.channelItems.push(mk(r, true));
    }
  }
  const refreshDummyTargets = (useX: boolean) => {
    const pos = (id: string) => (useX ? nodeItem.get(id)!.x : nodeItem.get(id)!.desired);
    for (const grp of groups) {
      const a = pos(grp.s);
      const b = pos(grp.t);
      const k = grp.chain.length;
      grp.chain.forEach((it, i) => {
        const v = a + ((b - a) * (i + 1)) / (k + 1);
        it.desired = v;
        it.base = v;
        if (!useX) it.x = v;
      });
      if (grp.channelItems.length) {
        const ns = nodeItem.get(grp.s)!;
        const nt = nodeItem.get(grp.t)!;
        const edge =
          grp.side > 0
            ? Math.max(pos(grp.s) + ns.size / 2, pos(grp.t) + nt.size / 2) + opts.nodeGap * 0.5 + grp.corridor / 2
            : Math.min(pos(grp.s) - ns.size / 2, pos(grp.t) - nt.size / 2) - opts.nodeGap * 0.5 - grp.corridor / 2;
        grp.channelItems.forEach((it) => {
          it.desired = edge;
          it.base = edge;
          if (!useX) it.x = edge;
        });
      }
    }
  };
  refreshDummyTargets(false);
  const gapBetween = (a: Item, b: Item) => {
    if (a.node && b.node) return opts.nodeGap;
    if (a.node || b.node) return Math.max(6, opts.nodeGap * 0.4);
    return Math.max(3, opts.trackGap);
  };
  const place = (items: Item[], key: (it: Item) => number) => pav(items, key, gapBetween);
  ranks.forEach((items) => place(items, (it) => it.desired));
  refreshDummyTargets(true);
  ranks.forEach((items) => place(items, (it) => it.desired));

  if (opts.crossPlacement !== 'lanes') {
    const { up, down } = connections(groups, nodeItem);
    const lambda = opts.crossPlacement === 'sugiyama' ? 1 : 0.5;
    const sweeps = opts.crossPlacement === 'sugiyama' ? 8 : 4;
    for (let s = 0; s < sweeps; s++) {
      const downward = s % 2 === 0;
      const order = downward ? ranks : [...ranks].reverse();
      for (const items of order) {
        const nb = downward ? up : down;
        place(items, (it) => {
          const list = nb.get(it);
          if (!list || list.length === 0) return lambda === 1 ? it.x : it.base;
          const tw = list.reduce((acc, [, w]) => acc + w, 0);
          const bary = list.reduce((acc, [o, w]) => acc + o.x * w, 0) / tw;
          return (1 - lambda) * it.base + lambda * bary;
        });
      }
    }
  }

  // Straighten long-arc chains where the neighbours leave room.
  const sortedRanks = () => ranks.map((items) => [...items].sort((a, b) => a.x - b.x));
  let byX = sortedRanks();
  const fits = (it: Item, c: number) => {
    const row = byX[it.rank];
    const i = row.indexOf(it);
    const L = row[i - 1];
    const R = row[i + 1];
    if (L && c - it.size / 2 - gapBetween(L, it) < L.x + L.size / 2 - 0.01) return false;
    if (R && c + it.size / 2 + gapBetween(it, R) > R.x - R.size / 2 + 0.01) return false;
    return true;
  };
  for (const grp of [...groups].sort((a, b) => b.chain.length - a.chain.length)) {
    if (grp.chain.length === 0) continue;
    const xs = grp.chain.map((it) => it.x).sort((a, b) => a - b);
    const median = xs[xs.length >> 1];
    const candidates = [nodeItem.get(grp.s)!.x, nodeItem.get(grp.t)!.x, median];
    for (const c of candidates) {
      if (grp.chain.every((it) => fits(it, c))) {
        grp.chain.forEach((it) => (it.x = c));
        byX = sortedRanks();
        break;
      }
    }
  }

  // Loop channels: one straight line per loop, inner loops first, clear of nodes.
  const placedChannels: Group[] = [];
  for (const grp of groups
    .filter((x) => x.channelItems.length > 0)
    .sort((a, b) => a.channelItems.length - b.channelItems.length)) {
    const half = grp.corridor / 2;
    const clear = Math.max(6, opts.nodeGap * 0.4);
    let X = grp.side > 0 ? Math.max(...grp.channelItems.map((i) => i.x)) : Math.min(...grp.channelItems.map((i) => i.x));
    const r0 = rank.get(grp.t)!;
    const r1 = rank.get(grp.s)!;
    for (let iter = 0; iter < 200; iter++) {
      let moved = false;
      for (let r = r0; r <= r1; r++) {
        for (const it of ranks[r]) {
          if (!it.node) continue;
          const lo = it.x - it.size / 2;
          const hi = it.x + it.size / 2;
          if (X + half + clear > lo && X - half - clear < hi) {
            X = grp.side > 0 ? hi + clear + half : lo - clear - half;
            moved = true;
          }
        }
      }
      for (const o of placedChannels) {
        const o0 = rank.get(o.t)!;
        const o1 = rank.get(o.s)!;
        if (o1 < r0 || o0 > r1) continue;
        const need = (o.corridor + grp.corridor) / 2 + Math.max(3, opts.trackGap);
        if (Math.abs(X - o.channelX) < need) {
          X = grp.side > 0 ? o.channelX + need : o.channelX - need;
          moved = true;
        }
      }
      if (!moved) break;
    }
    grp.channelX = X;
    grp.channelItems.forEach((it) => (it.x = X));
    placedChannels.push(grp);
  }

  // ------------------------------------------------------------------
  // 5a. Ports
  // ------------------------------------------------------------------
  const centerMode = opts.portMode === 'center';
  const itemX = (id: string) => nodeItem.get(id)!.x;
  const isAdjacent = (a: string, b: string) => {
    const r = rank.get(a)!;
    const row = byX[r];
    const ia = row.indexOf(nodeItem.get(a)!);
    const ib = row.indexOf(nodeItem.get(b)!);
    const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
    for (let i = lo + 1; i < hi; i++) if (row[i].node) return false;
    return true;
  };
  const blocksStub = (id: string, X: number) => {
    const x0 = itemX(id);
    const lo = Math.min(x0, X);
    const hi = Math.max(x0, X);
    return ranks[rank.get(id)!].some((it) => it.node && it.key !== id && it.x + it.size / 2 > lo && it.x - it.size / 2 < hi);
  };
  const nextX = (grp: Group) => (grp.chain.length ? grp.chain[0].x : itemX(grp.t));
  const prevX = (grp: Group) => (grp.chain.length ? grp.chain[grp.chain.length - 1].x : itemX(grp.s));
  const attachments: Attach[] = [];
  for (const grp of groups) {
    if (grp.cls === 'interleave') continue;
    let src: Side;
    let tgt: Side;
    let ks = 0;
    let kt = 0;
    if (grp.cls === 'forward') {
      src = 'out';
      tgt = 'in';
      ks = nextX(grp);
      kt = prevX(grp);
      if (opts.portMode === 'nearest' && grp.chain.length === 0) {
        const dx = itemX(grp.t) - itemX(grp.s);
        const dy = opts.rankGap + (flowSize(grp.s) + flowSize(grp.t)) / 2;
        if (Math.abs(dx) > 1.6 * dy) {
          src = dx > 0 ? 'right' : 'left';
          tgt = 'in';
          ks = 2e6 + Math.abs(dx);
        }
      }
    } else if (grp.cls === 'back') {
      if (opts.backArcStyle === 'reversed') {
        src = 'in';
        tgt = 'out';
        ks = nextX(grp);
        kt = prevX(grp);
      } else if (opts.portMode === 'flowOnly') {
        src = 'out';
        tgt = 'in';
        const X = sideChannel ? grp.channelX : itemX(grp.s) + grp.side * 1000;
        ks = X;
        kt = X;
      } else {
        src = grp.side > 0 ? 'right' : 'left';
        tgt = src;
        const dS = sideChannel ? Math.abs(grp.channelX - itemX(grp.s)) : rank.get(grp.s)! - rank.get(grp.t)!;
        const dT = sideChannel ? Math.abs(grp.channelX - itemX(grp.t)) : rank.get(grp.s)! - rank.get(grp.t)!;
        ks = -1e6 + dS;
        kt = 1e6 - dT;
        // A node between an end and its channel would be crossed by the
        // horizontal stub: leave/enter through the bottom/top port instead
        // and make the horizontal run in the free gap between the layers.
        if (sideChannel && blocksStub(grp.s, grp.channelX)) {
          src = 'out';
          ks = grp.channelX;
        }
        if (sideChannel && blocksStub(grp.t, grp.channelX)) {
          tgt = 'in';
          kt = grp.channelX;
        }
      }
    } else {
      // flat
      if (isAdjacent(grp.s, grp.t)) {
        const right = itemX(grp.t) > itemX(grp.s);
        src = right ? 'right' : 'left';
        tgt = right ? 'left' : 'right';
      } else {
        src = 'in';
        tgt = 'in';
        ks = itemX(grp.t);
        kt = itemX(grp.s);
      }
    }
    grp.srcSide = src;
    grp.tgtSide = tgt;
    attachments.push({ g: grp, node: grp.s, side: src, isSource: true, key: ks });
    attachments.push({ g: grp, node: grp.t, side: tgt, isSource: false, key: kt });
  }
  const bySide = new Map<string, Attach[]>();
  for (const at of attachments) {
    const k = `${at.node}\u0001${at.side}`;
    const list = bySide.get(k) ?? [];
    list.push(at);
    bySide.set(k, list);
  }
  const spread = mergePoints ? 'byType' : opts.portSpread;
  for (const list of bySide.values()) {
    const node = nodeById.get(list[0].node)!;
    const side = list[0].side;
    const L = side === 'in' || side === 'out' ? crossSize(node.id) : flowSize(node.id);
    const margin = Math.min(10, L * 0.18);
    const avail = Math.max(0, L - 2 * margin);
    list.sort((a, b) => a.key - b.key || a.g.lane - b.g.lane || (a.g.id < b.g.id ? -1 : 1));
    let positions: number[];
    // Terminals carry one object type, so "per type" means one port there;
    // they still get distributed ports unless arcs are meant to meet.
    if (centerMode || spread === 'single' || (mergePoints && node.kind !== 'activity')) {
      positions = list.map(() => 0);
    } else if (spread === 'byType' && node.kind === 'activity') {
      const nodeTypes = [...node.types].sort((a, b) => (laneIdx.get(a) ?? 0) - (laneIdx.get(b) ?? 0));
      const slot = (t: string) => {
        const i = nodeTypes.indexOf(t);
        return nodeTypes.length <= 1 ? 0 : -avail / 2 + (avail * (i + 0.5)) / nodeTypes.length;
      };
      positions = list.map((at) => at.g.members.reduce((s, m) => s + slot(m.type), 0) / at.g.members.length);
      // Side ports run along the flow axis: keep the order of the type slots
      // only on the flow sides, spread side attachments evenly.
      if (side === 'left' || side === 'right') positions = evenly(list, avail, opts.trackGap);
    } else {
      positions = evenly(list, avail, opts.trackGap);
    }
    list.forEach((at, i) => {
      if (at.isSource) at.g.srcPos = positions[i];
      else at.g.tgtPos = positions[i];
    });
  }

  // ------------------------------------------------------------------
  // 5b. Channel tracks and rank positions
  // ------------------------------------------------------------------
  const orthogonalish = opts.edgeStyle === 'orthogonal' || opts.edgeStyle === 'octilinear';
  const portCross = (grp: Group, source: boolean) => {
    const id = source ? grp.s : grp.t;
    const side = source ? grp.srcSide : grp.tgtSide;
    const pos = source ? grp.srcPos : grp.tgtPos;
    if (side === 'in' || side === 'out') return itemX(id) + pos;
    return itemX(id) + (side === 'right' ? 1 : -1) * crossSize(id) / 2;
  };
  const segments: Segment[] = [];
  const chainXs = (grp: Group) => [portCross(grp, true), ...grp.chain.map((it) => it.x), portCross(grp, false)];
  for (const grp of groups) {
    const wrapsLoop = grp.cls === 'back' && sideChannel && (grp.srcSide === 'out' || grp.tgtSide === 'in');
    if (!orthogonalish && !(grp.cls === 'flat' && grp.srcSide === 'in') && !wrapsLoop) continue;
    const rs = rank.get(grp.s)!;
    const rt = rank.get(grp.t)!;
    if (grp.cls === 'forward' && grp.srcSide === 'out') {
      const xs = chainXs(grp);
      xs.slice(0, -1).forEach((x, i) => segments.push(seg(grp, rs + i, x, xs[i + 1])));
    } else if (grp.cls === 'forward') {
      const xs = chainXs(grp);
      xs.slice(1, -1).forEach((x, i) => segments.push(seg(grp, rs + 1 + i, x, xs[i + 2])));
    } else if (grp.cls === 'back' && opts.backArcStyle === 'reversed') {
      const xs = chainXs(grp);
      xs.slice(0, -1).forEach((x, i) => segments.push(seg(grp, rs - 1 - i, x, xs[i + 1])));
    } else if (wrapsLoop) {
      const X = grp.channelX;
      if (grp.srcSide === 'out') segments.push(seg(grp, rs, portCross(grp, true), X));
      if (grp.tgtSide === 'in') segments.push(seg(grp, rt - 1, X, portCross(grp, false)));
    } else if (grp.cls === 'flat' && grp.srcSide === 'in') {
      segments.push(seg(grp, rs - 1, portCross(grp, true), portCross(grp, false)));
    }
  }
  const channelNeed = new Map<number, number>();
  const channelTracks = new Map<number, Segment[][]>();
  const byChannel = new Map<number, Segment[]>();
  for (const s of segments) {
    if (Math.abs(s.to - s.from) < 0.5) continue;
    const list = byChannel.get(s.channel) ?? [];
    list.push(s);
    byChannel.set(s.channel, list);
  }
  for (const [c, list] of byChannel) {
    // Rightward jogs that start further right go higher (and vice versa):
    // this avoids most crossings between jogs of the same channel.
    list.sort((a, b) => {
      const ka = a.to >= a.from ? -a.from : a.from + 1e5;
      const kb = b.to >= b.from ? -b.from : b.from + 1e5;
      return ka - kb;
    });
    const tracks: Segment[][] = [];
    for (const s of list) {
      const lo = Math.min(s.from, s.to) - opts.trackGap - s.g.corridor;
      const hi = Math.max(s.from, s.to) + opts.trackGap + s.g.corridor;
      let placed = false;
      for (let i = 0; i < tracks.length && !placed; i++) {
        if (tracks[i].every((o) => Math.max(o.from, o.to) < lo || Math.min(o.from, o.to) > hi)) {
          tracks[i].push(s);
          s.track = i;
          placed = true;
        }
      }
      if (!placed) {
        s.track = tracks.length;
        tracks.push([s]);
      }
    }
    channelTracks.set(c, tracks);
    const thick = tracks.reduce((acc, tr) => acc + Math.max(...tr.map((s) => s.g.corridor)), 0);
    channelNeed.set(c, thick + (tracks.length + 1) * Math.max(4, opts.trackGap * 1.6) + 12);
  }
  const bandH: number[] = ranks.map((items) => Math.max(14, ...items.filter((i) => i.node).map((i) => flowSize(i.key))));
  const gapAfter: number[] = ranks.map((_, r) => Math.max(opts.rankGap, channelNeed.get(r) ?? 0));
  const bandTop: number[] = [];
  let y = Math.max(opts.rankGap, channelNeed.get(-1) ?? 0);
  for (let r = 0; r < nRanks; r++) {
    bandTop.push(y);
    y += bandH[r] + gapAfter[r];
  }
  const channelTop = (c: number) => (c < 0 ? bandTop[0] - Math.max(opts.rankGap, channelNeed.get(-1) ?? 0) : bandTop[c] + bandH[c]);
  const channelH = (c: number) => (c < 0 ? Math.max(opts.rankGap, channelNeed.get(-1) ?? 0) : gapAfter[c]);
  for (const [c, tracks] of channelTracks) {
    const pitch = Math.max(4, opts.trackGap * 1.6);
    const sizes = tracks.map((tr) => Math.max(...tr.map((s) => s.g.corridor)));
    const total = sizes.reduce((a, b) => a + b, 0) + pitch * (tracks.length - 1);
    let cy = channelTop(c) + channelH(c) / 2 - total / 2;
    tracks.forEach((tr, i) => {
      const mid = cy + sizes[i] / 2;
      tr.forEach((s) => (s.y = mid));
      cy += sizes[i] + pitch;
    });
  }
  for (const s of segments) {
    if (Math.abs(s.to - s.from) < 0.5) s.y = channelTop(s.channel) + channelH(s.channel) / 2;
  }
  const segsOf = new Map<Group, Segment[]>();
  for (const s of segments) {
    const list = segsOf.get(s.g) ?? [];
    list.push(s);
    segsOf.set(s.g, list);
  }
  const fy = (id: string) => bandTop[rank.get(id)!] + bandH[rank.get(id)!] / 2;

  // ------------------------------------------------------------------
  // 5c. Route center lines (flow space)
  // ------------------------------------------------------------------
  const sideNormal = (side: Side): Pt =>
    side === 'in' ? { x: 0, y: -1 } : side === 'out' ? { x: 0, y: 1 } : side === 'right' ? { x: 1, y: 0 } : { x: -1, y: 0 };
  const portPoint = (id: string, side: Side, pos: number): Pt => {
    const x = itemX(id);
    const c = fy(id);
    const cw = crossSize(id) / 2;
    const fh = flowSize(id) / 2;
    if (side === 'in') return { x: x + pos, y: c - fh };
    if (side === 'out') return { x: x + pos, y: c + fh };
    if (side === 'right') return { x: x + cw, y: c + pos };
    return { x: x - cw, y: c + pos };
  };
  const stub = Math.min(16, opts.rankGap * 0.3);
  for (const grp of groups) {
    if (grp.cls === 'interleave') {
      grp.ctrl = interleaveRoute(grp);
      grp.center = grp.ctrl;
      continue;
    }
    grp.srcN = sideNormal(grp.srcSide!);
    grp.tgtN = sideNormal(grp.tgtSide!);
    grp.srcPt = portPoint(grp.s, grp.srcSide!, grp.srcPos);
    grp.tgtPt = portPoint(grp.t, grp.tgtSide!, grp.tgtPos);
    if (centerMode && grp.cls === 'forward') {
      const toward = grp.chain.length ? { x: grp.chain[0].x, y: bandTop[grp.chain[0].rank] } : { x: itemX(grp.t), y: fy(grp.t) };
      const back = grp.chain.length
        ? { x: grp.chain[grp.chain.length - 1].x, y: bandTop[grp.chain[grp.chain.length - 1].rank] + bandH[grp.chain[grp.chain.length - 1].rank] }
        : { x: itemX(grp.s), y: fy(grp.s) };
      grp.srcPt = clipToRect({ x: itemX(grp.s), y: fy(grp.s) }, crossSize(grp.s) / 2, flowSize(grp.s) / 2, toward);
      grp.tgtPt = clipToRect({ x: itemX(grp.t), y: fy(grp.t) }, crossSize(grp.t) / 2, flowSize(grp.t) / 2, back);
      grp.srcN = unit({ x: toward.x - grp.srcPt.x, y: toward.y - grp.srcPt.y });
      grp.tgtN = unit({ x: back.x - grp.tgtPt.x, y: back.y - grp.tgtPt.y });
    }
    if (mergePoints) {
      grp.srcJ = { x: grp.srcPt.x + grp.srcN.x * stub, y: grp.srcPt.y + grp.srcN.y * stub };
      grp.tgtJ = { x: grp.tgtPt.x + grp.tgtN.x * stub, y: grp.tgtPt.y + grp.tgtN.y * stub };
    }
    const P0 = grp.srcJ ?? grp.srcPt;
    const P1 = grp.tgtJ ?? grp.tgtPt;
    const n0 = grp.srcN;
    const into = { x: -grp.tgtN.x, y: -grp.tgtN.y };
    if (grp.cls === 'forward' || (grp.cls === 'back' && opts.backArcStyle === 'reversed')) {
      const down = grp.cls === 'forward';
      const gates = grp.chain.map((it) => ({
        x: it.x,
        entry: down ? bandTop[it.rank] : bandTop[it.rank] + bandH[it.rank],
        exit: down ? bandTop[it.rank] + bandH[it.rank] : bandTop[it.rank],
      }));
      const segs = (segsOf.get(grp) ?? []).sort((a, b) => (down ? a.channel - b.channel : b.channel - a.channel));
      grp.ctrl = chainRoute(P0, n0, gates, P1, into, segs, down);
    } else if (grp.cls === 'back' && opts.backArcStyle === 'sideChannel') {
      const X = grp.channelX;
      const segs = segsOf.get(grp) ?? [];
      const head: Pt[] =
        grp.srcSide === 'out'
          ? (() => {
              const yb = segs.find((s) => s.channel === rank.get(grp.s))?.y ?? P0.y + stub * 1.5;
              return [P0, { x: P0.x, y: yb }, { x: X, y: yb }];
            })()
          : [P0, { x: X, y: P0.y }];
      const tail: Pt[] =
        grp.tgtSide === 'in'
          ? (() => {
              const ya = segs.find((s) => s.channel === rank.get(grp.t)! - 1)?.y ?? P1.y - stub * 1.5;
              return [{ x: X, y: ya }, { x: P1.x, y: ya }, P1];
            })()
          : [{ x: X, y: P1.y }, P1];
      grp.ctrl = [...head, ...tail];
    } else if (grp.cls === 'back') {
      // Side curve: one cubic bulging to the loop side.
      const span = Math.abs(P0.y - P1.y);
      const bulge = 40 + 0.25 * span;
      const c1 = grp.srcSide === 'out'
        ? { x: P0.x + grp.side * bulge, y: P0.y + bulge * 0.8 }
        : { x: P0.x + grp.side * bulge, y: P0.y };
      const c2 = grp.tgtSide === 'in'
        ? { x: P1.x + grp.side * bulge, y: P1.y - bulge * 0.8 }
        : { x: P1.x + grp.side * bulge, y: P1.y };
      grp.ctrl = [P0, c1, c2, P1];
    } else {
      // flat
      if (grp.srcSide === 'in') {
        const s = segsOf.get(grp)?.[0];
        const yt = s?.y ?? P0.y - Math.max(18, opts.rankGap * 0.4);
        grp.ctrl = [P0, { x: P0.x, y: yt }, { x: P1.x, y: yt }, P1];
      } else {
        grp.ctrl = [P0, P1];
      }
    }
    grp.center = styleRoute(grp, into);
  }

  function chainRoute(P0: Pt, n0: Pt, gates: Array<{ x: number; entry: number; exit: number }>, P1: Pt, into: Pt, segs: Segment[], down: boolean): Pt[] {
    const v = down ? 1 : -1;
    if (opts.edgeStyle === 'straight') return [P0, P1];
    if (!orthogonalish) {
      const pts: Pt[] = [P0];
      gates.forEach((gt) => {
        pts.push({ x: gt.x, y: gt.entry }, { x: gt.x, y: gt.exit });
      });
      pts.push(P1);
      return pts;
    }
    const sideStart = n0.x !== 0;
    const sideEnd = into.x !== 0;
    const xs = [P0.x, ...gates.map((gt) => gt.x), P1.x];
    const pts: Pt[] = [P0];
    let si = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      if (i === 0 && sideStart) {
        pts.push({ x: xs[1], y: P0.y });
        continue;
      }
      if (i === xs.length - 2 && sideEnd) {
        pts.push({ x: xs[i], y: P1.y });
        continue;
      }
      const s = segs[si++];
      const ty = s ? s.y : (i === 0 ? P0.y + v * stub : gates[i - 1].exit + v * stub);
      const xa = xs[i];
      const xb = xs[i + 1];
      if (opts.edgeStyle === 'octilinear' && Math.abs(xb - xa) > 0.5) {
        const c = s ? s.channel : 0;
        const h = Math.max(4, (channelH(c) / 2 - 4) * 0.9);
        const delta = Math.abs(xb - xa);
        const sx = Math.sign(xb - xa);
        if (delta <= 2 * h) {
          pts.push({ x: xa, y: ty - (v * delta) / 2 }, { x: xb, y: ty + (v * delta) / 2 });
        } else {
          pts.push({ x: xa, y: ty - v * h }, { x: xa + sx * h, y: ty }, { x: xb - sx * h, y: ty }, { x: xb, y: ty + v * h });
        }
      } else {
        pts.push({ x: xa, y: ty }, { x: xb, y: ty });
      }
    }
    pts.push(P1);
    return pts;
  }

  function styleRoute(grp: Group, into: Pt): Pt[] {
    const ctrl = grp.ctrl;
    const isChannel = grp.cls === 'back' && opts.backArcStyle === 'sideChannel';
    const isCurve = grp.cls === 'back' && opts.backArcStyle === 'curve';
    if (isCurve) return cubic(ctrl[0], ctrl[1], ctrl[2], ctrl[3], 22);
    const style = opts.edgeStyle;
    if (style === 'straight' || style === 'polyline') return simplify(ctrl);
    if (style === 'orthogonal') return roundCorners(ctrl, opts.cornerRadius);
    if (style === 'octilinear') return roundCorners(isChannel || grp.cls === 'flat' ? chamfer(ctrl, Math.max(6, opts.cornerRadius)) : ctrl, opts.cornerRadius * 0.6);
    if (isChannel || grp.cls === 'flat') return roundCorners(ctrl, Math.max(14, opts.cornerRadius * 2.2), 8);
    if (style === 'spline') {
      const n0 = grp.srcN;
      const pts = [ctrl[0], { x: ctrl[0].x + n0.x * stub, y: ctrl[0].y + n0.y * stub }];
      const inner = ctrl.slice(1, -1);
      // One point per gate (its middle) keeps the spline calm.
      for (let i = 0; i + 1 < inner.length; i += 2) pts.push({ x: inner[i].x, y: (inner[i].y + inner[i + 1].y) / 2 });
      const last = ctrl[ctrl.length - 1];
      pts.push({ x: last.x - into.x * stub, y: last.y - into.y * stub }, last);
      return catmullRom(pts, 10);
    }
    return flowCurve(ctrl, grp.srcN, into, 12);
  }

  function interleaveRoute(grp: Group): Pt[] {
    const a = { x: itemX(grp.s), y: fy(grp.s) };
    const b = { x: itemX(grp.t), y: fy(grp.t) };
    const d = dist(a, b) || 1;
    const nrm = { x: -(b.y - a.y) / d, y: (b.x - a.x) / d };
    const bulge = 0.18 * d + 10;
    const c = { x: (a.x + b.x) / 2 + nrm.x * bulge, y: (a.y + b.y) / 2 + nrm.y * bulge };
    const p0 = clipToRect(a, crossSize(grp.s) / 2, flowSize(grp.s) / 2, c);
    const p1 = clipToRect(b, crossSize(grp.t) / 2, flowSize(grp.t) / 2, c);
    return quadratic(p0, c, p1, 16);
  }

  // ------------------------------------------------------------------
  // 5d. Members, trunks, self loops
  // ------------------------------------------------------------------
  const routed: RoutedArc[] = [];
  const metricArcs: MetricArc[] = [];
  let mergedIndex = 0;
  for (const grp of groups) {
    const n = grp.members.length;
    const isMerged = bundling === 'merged' && n > 1;
    const mIdx = isMerged ? mergedIndex++ : -1;
    grp.members.forEach((m, k) => {
      let pts: Pt[];
      if (n === 1 || isMerged) pts = grp.center;
      else if (bundling === 'fanned') {
        const off = grp.offsets[k];
        pts = offsetPolyline(resample(grp.center, 28), (t) => off * Math.sin(Math.PI * t));
      } else pts = offsetPolyline(grp.center, grp.offsets[k]);
      routed.push({
        id: m.id,
        source: m.source,
        target: m.target,
        type: m.type,
        weight: m.weight,
        cls: grp.cls,
        width: isMerged ? grp.corridor : grp.widths[k],
        points: pts,
        arrow: !mergePoints || grp.cls === 'interleave',
        mergedGroup: isMerged ? { index: k, size: n, types: grp.members.map((x) => x.type) } : undefined,
        bundleSize: n,
        avgLeadTime: m.avgLeadTime,
      });
      metricArcs.push({
        id: m.id,
        source: m.source,
        target: m.target,
        groupKey: isMerged ? `m${mIdx}` : undefined,
        points: pts,
        ctrl: grp.ctrl,
      });
    });
  }

  const trunks: Trunk[] = [];
  const junctions: Array<Pt & { type: string }> = [];
  if (mergePoints) {
    const byPort = new Map<string, { pt: Pt; j: Pt; type: string; w: number; count: number; incoming: boolean }>();
    for (const grp of groups) {
      if (grp.cls === 'interleave' || !grp.srcJ || !grp.tgtJ) continue;
      const m = grp.members[0];
      const add = (node: string, side: Side | null, pt: Pt, j: Pt, incoming: boolean) => {
        const k = `${node}\u0001${side}\u0001${m.type}\u0001${incoming}`;
        const e = byPort.get(k);
        if (e) {
          e.w += m.weight;
          e.count++;
        } else byPort.set(k, { pt, j, type: m.type, w: m.weight, count: 1, incoming });
      };
      add(grp.s, grp.srcSide, grp.srcPt, grp.srcJ, false);
      add(grp.t, grp.tgtSide, grp.tgtPt, grp.tgtJ, true);
    }
    for (const e of byPort.values()) {
      const width = Math.min(opts.maxWidth * 1.4, widthOf(e.w, e.type));
      trunks.push({ type: e.type, points: e.incoming ? [e.j, e.pt] : [e.pt, e.j], width, arrow: e.incoming });
      if (e.count > 1) junctions.push({ ...e.j, type: e.type });
    }
  }

  const selfLoops: SelfLoop[] = [];
  if (opts.selfLoopStyle !== 'hidden') {
    const byNode = new Map<string, LabArc[]>();
    for (const a of selfArcs) {
      if (!nodeItem.has(a.source)) continue;
      const list = byNode.get(a.source) ?? [];
      list.push(a);
      byNode.set(a.source, list);
    }
    for (const [id, list] of byNode) {
      list.sort((a, b) => (laneIdx.get(a.type) ?? 0) - (laneIdx.get(b.type) ?? 0));
      const cx = itemX(id);
      const cy = fy(id);
      const hw = crossSize(id) / 2;
      const hh = flowSize(id) / 2;
      list.forEach((a, k) => {
        const width = widthOf(a.weight, a.type);
        let points: Pt[] = [];
        let center: Pt = { x: cx + hw, y: cy - hh };
        let radius = 0;
        if (opts.selfLoopStyle === 'cornerRing') {
          radius = 7 + k * (5 + width);
          center = { x: cx + hw - 2, y: cy - hh + 2 };
          for (let i = 0; i <= 28; i++) {
            const th = Math.PI + (i / 28) * Math.PI * 1.5;
            points.push({ x: center.x + radius * Math.cos(th), y: center.y + radius * Math.sin(th) });
          }
        } else if (opts.selfLoopStyle === 'sideLoop') {
          // Opposite to the type's loop channels to stay clear of them.
          const side = -sideOf(a.type);
          const L = 20 + k * (9 + width);
          const h = Math.min(hh * 0.7, 5 + k * 3);
          const x0 = cx + side * hw;
          const p0 = { x: x0, y: cy - h };
          const p1 = { x: x0, y: cy + h };
          points = cubic(p0, { x: x0 + side * L * 1.25, y: cy - h - L * 0.7 }, { x: x0 + side * L * 1.25, y: cy + h + L * 0.7 }, p1, 24);
          center = { x: x0 + side * L * 0.9, y: cy };
        } else {
          radius = 8;
          center = { x: cx + hw - 6 - k * 19, y: cy - hh };
        }
        selfLoops.push({ node: id, type: a.type, weight: a.weight, width, style: opts.selfLoopStyle, points, center, radius });
      });
    }
  }

  // ------------------------------------------------------------------
  // 6. Flow space → screen
  // ------------------------------------------------------------------
  const T = (p: Pt): Pt => {
    switch (opts.direction) {
      case 'LR':
        return { x: p.y, y: p.x };
      case 'BT':
        return { x: p.x, y: -p.y };
      case 'RL':
        return { x: -p.y, y: p.x };
      default:
        return { x: p.x, y: p.y };
    }
  };
  const placed: PlacedNode[] = g.nodes.map((n) => {
    const s = screenSize.get(n.id)!;
    const p = T({ x: itemX(n.id), y: fy(n.id) });
    return {
      id: n.id,
      label: n.label,
      kind: n.kind,
      types: [...n.types].sort((a, b) => (laneIdx.get(a) ?? 0) - (laneIdx.get(b) ?? 0)),
      frequency: n.frequency,
      x: p.x,
      y: p.y,
      width: s.w,
      height: s.h,
      objectType: n.kind !== 'activity' ? n.types[0] : undefined,
    };
  });
  for (const r of routed) r.points = r.points.map(T);
  for (const m of metricArcs) {
    m.points = m.points.map(T);
    m.ctrl = m.ctrl.map(T);
  }
  for (const t of trunks) t.points = t.points.map(T);
  const jScreen = junctions.map((j) => ({ ...T(j), type: j.type }));
  for (const s of selfLoops) {
    s.points = s.points.map(T);
    s.center = T(s.center);
  }
  for (const r of routed) r.labelPos = pointAt(r.points, 0.5).p;

  const fMin = (bandTop[0] ?? 0) - opts.rankGap * 0.5;
  const fMax = (bandTop[nRanks - 1] ?? 0) + (bandH[nRanks - 1] ?? 0) + opts.rankGap * 0.5;
  const lanes = laneOrder.map((t) => {
    const ext = extents.get(t)!;
    const c0 = laneCenter.get(t)! - ext.left * U - opts.laneGap * 0.3;
    const c1 = laneCenter.get(t)! + ext.right * U + opts.laneGap * 0.3;
    const a = T({ x: c0, y: fMin });
    const b = T({ x: c1, y: fMax });
    return { type: t, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  });
  const allX = ranks.flat().map((i) => i.x);
  const cMin = Math.min(...allX) - U / 2;
  const cMax = Math.max(...allX) + U / 2;
  const rankLines = bandTop.map((top, r) => {
    const f = top + bandH[r] / 2;
    return { a: T({ x: cMin, y: f }), b: T({ x: cMax, y: f }) };
  });

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (p: Pt, pad = 0) => {
    bounds.minX = Math.min(bounds.minX, p.x - pad);
    bounds.minY = Math.min(bounds.minY, p.y - pad);
    bounds.maxX = Math.max(bounds.maxX, p.x + pad);
    bounds.maxY = Math.max(bounds.maxY, p.y + pad);
  };
  placed.forEach((n) => {
    grow({ x: n.x - n.width / 2, y: n.y - n.height / 2 });
    grow({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
  });
  routed.forEach((r) => r.points.forEach((p) => grow(p, r.width)));
  selfLoops.forEach((s) => {
    s.points.forEach((p) => grow(p, s.width));
    grow(s.center, s.radius + 4);
  });
  if (opts.showLanes) {
    lanes.forEach((l) => {
      grow({ x: l.x, y: l.y });
      grow({ x: l.x + l.width, y: l.y + l.height });
    });
  }

  const m = measure(metricArcs, placed);
  const typeSummaries: TypeSummary[] = laneOrder.map((t) => {
    const block = blocks.get(t);
    const tArcs = arcs.filter((a) => a.type === t);
    return {
      type: t,
      lane: laneIdx.get(t)!,
      blockTree: block ? describeBlock(block) : '—',
      activities: typeActivities.get(t)?.size ?? 0,
      backArcs: tArcs.filter((a) => typedClass.get(a.id) === 'back').length,
      interleaveArcs: tArcs.filter((a) => typedClass.get(a.id) === 'interleave').length,
    };
  });

  return {
    nodes: placed,
    arcs: routed,
    trunks,
    junctions: jScreen,
    selfLoops,
    lanes,
    rankLines,
    bounds,
    laneOrder,
    typeSummaries,
    metrics: {
      ...m,
      backArcs: routed.filter((r) => r.cls === 'back').length,
      width: Math.round(bounds.maxX - bounds.minX),
      height: Math.round(bounds.maxY - bounds.minY),
      ms: Math.round(now() - started),
    },
    notes,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seg(g: Group, channel: number, from: number, to: number): Segment {
  return { g, channel, from, to, track: 0, y: 0 };
}

function unit(p: Pt): Pt {
  const l = Math.hypot(p.x, p.y) || 1;
  return { x: p.x / l, y: p.y / l };
}

function chamfer(points: Pt[], c: number): Pt[] {
  const pts = simplify(points);
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const a = pts[i - 1];
    const b = pts[i + 1];
    const cc = Math.min(c, dist(a, p) / 2, dist(p, b) / 2);
    const ua = unit({ x: a.x - p.x, y: a.y - p.y });
    const ub = unit({ x: b.x - p.x, y: b.y - p.y });
    out.push({ x: p.x + ua.x * cc, y: p.y + ua.y * cc }, { x: p.x + ub.x * cc, y: p.y + ub.y * cc });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Evenly spread attachments along a side, compressing when crowded. */
function evenly(list: Attach[], avail: number, trackGap: number): number[] {
  const n = list.length;
  if (n === 1) return [0];
  const widths = list.map((a) => Math.max(2, a.g.corridor));
  const pitch = avail / n;
  if (pitch >= Math.max(...widths) + trackGap) return list.map((_, i) => -avail / 2 + pitch * (i + 0.5));
  const total = widths.reduce((s, w) => s + w, 0) + trackGap * (n - 1);
  const scale = total > avail && total > 0 ? avail / total : 1;
  let c = (-total * scale) / 2;
  return widths.map((w) => {
    const p = c + (w * scale) / 2;
    c += (w + trackGap) * scale;
    return p;
  });
}

/**
 * Isotonic regression with minimum separation: items keep their order by
 * `key` and get the positions closest (weighted least squares) to their keys
 * without overlapping.
 */
function pav(items: Item[], key: (it: Item) => number, gap: (a: Item, b: Item) => number) {
  if (items.length === 0) return;
  const keyed = items.map((it) => ({ it, k: key(it) }));
  keyed.sort((a, b) => a.k - b.k || a.it.tie - b.it.tie);
  const offs: number[] = [0];
  for (let i = 1; i < keyed.length; i++) {
    const a = keyed[i - 1].it;
    const b = keyed[i].it;
    offs.push(offs[i - 1] + (a.size + b.size) / 2 + gap(a, b));
  }
  const blocks: Array<{ sw: number; swy: number; from: number; to: number }> = [];
  keyed.forEach(({ it, k }, i) => {
    blocks.push({ sw: it.w, swy: it.w * (k - offs[i]), from: i, to: i });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.swy / a.sw <= b.swy / b.sw) break;
      blocks.splice(blocks.length - 2, 2, { sw: a.sw + b.sw, swy: a.swy + b.swy, from: a.from, to: b.to });
    }
  });
  for (const b of blocks) {
    const mean = b.swy / b.sw;
    for (let i = b.from; i <= b.to; i++) keyed[i].it.x = mean + offs[i];
  }
}

/** Neighbour lists between adjacent ranks for the barycentre sweeps. */
function connections(groups: Group[], nodeItem: Map<string, Item>) {
  const up = new Map<Item, Array<[Item, number]>>();
  const down = new Map<Item, Array<[Item, number]>>();
  const link = (a: Item, b: Item, w: number) => {
    // a is above b
    (down.get(a) ?? down.set(a, []).get(a)!).push([b, w]);
    (up.get(b) ?? up.set(b, []).get(b)!).push([a, w]);
  };
  for (const grp of groups) {
    const w = 1 + Math.log1p(grp.weight);
    if (grp.cls === 'forward') {
      const chain = [nodeItem.get(grp.s)!, ...grp.chain, nodeItem.get(grp.t)!];
      for (let i = 0; i + 1 < chain.length; i++) link(chain[i], chain[i + 1], w);
    } else if (grp.cls === 'back' && grp.chain.length) {
      const chain = [nodeItem.get(grp.t)!, ...[...grp.chain].reverse(), nodeItem.get(grp.s)!];
      for (let i = 0; i + 1 < chain.length; i++) link(chain[i], chain[i + 1], w * 0.5);
    } else if (grp.channelItems.length > 1) {
      for (let i = 0; i + 1 < grp.channelItems.length; i++) link(grp.channelItems[i], grp.channelItems[i + 1], w);
    }
  }
  return { up, down };
}

function layer(nodes: LabNode[], order: string[], dag: WArc[], opts: LayoutOptions): Map<string, number> {
  const kind = new Map(nodes.map((n) => [n.id, n.kind]));
  const preds = new Map<string, WArc[]>();
  const succs = new Map<string, WArc[]>();
  order.forEach((n) => {
    preds.set(n, []);
    succs.set(n, []);
  });
  dag.forEach((a) => {
    preds.get(a.t)!.push(a);
    succs.get(a.s)!.push(a);
  });
  const lb = (n: string) => (kind.get(n) === 'start' ? 0 : 1);
  const rank = new Map<string, number>();
  const fixUp = () => {
    for (const n of order) {
      let r = Math.max(rank.get(n) ?? 0, lb(n));
      for (const a of preds.get(n)!) r = Math.max(r, rank.get(a.s)! + 1);
      rank.set(n, r);
    }
  };
  if (opts.layering === 'longestPathBottom') {
    const h = new Map<string, number>();
    for (const n of [...order].reverse()) {
      let v = 0;
      for (const a of succs.get(n)!) v = Math.max(v, h.get(a.t)! + 1);
      h.set(n, v);
    }
    const H = Math.max(0, ...h.values());
    order.forEach((n) => rank.set(n, H + 1 - h.get(n)!));
    fixUp();
  } else {
    fixUp();
  }
  const laneTop = opts.terminalPlacement === 'laneTop';
  if (opts.layering === 'compact') {
    for (let pass = 0; pass < 6; pass++) {
      const seq = pass % 2 === 0 ? [...order].reverse() : order;
      for (const n of seq) {
        if (kind.get(n) !== 'activity') continue;
        let lo = lb(n);
        for (const a of preds.get(n)!) lo = Math.max(lo, rank.get(a.s)! + 1);
        let hi = Infinity;
        const vals: Array<[number, number]> = [];
        for (const a of preds.get(n)!) vals.push([rank.get(a.s)! + 1, a.w]);
        for (const a of succs.get(n)!) {
          if (laneTop && kind.get(a.t) === 'end') continue;
          hi = Math.min(hi, rank.get(a.t)! - 1);
          vals.push([rank.get(a.t)! - 1, a.w]);
        }
        if (hi <= lo || vals.length === 0) continue;
        vals.sort((a, b) => a[0] - b[0]);
        const total = vals.reduce((s, v) => s + v[1], 0);
        let acc = 0;
        let med = vals[0][0];
        for (const [v, w] of vals) {
          acc += w;
          if (acc >= total / 2) {
            med = v;
            break;
          }
        }
        rank.set(n, Math.min(hi, Math.max(lo, med)));
      }
    }
    fixUp();
  }
  // Terminals.
  const actRanks = order.filter((n) => kind.get(n) === 'activity').map((n) => rank.get(n)!);
  const maxAct = Math.max(1, ...actRanks);
  for (const n of order) {
    const k = kind.get(n);
    if (k === 'start') {
      if (laneTop) rank.set(n, 0);
      else {
        const s = succs.get(n)!.map((a) => rank.get(a.t)!);
        rank.set(n, Math.max(0, (s.length ? Math.min(...s) : 1) - 1));
      }
    } else if (k === 'end') {
      if (laneTop) rank.set(n, maxAct + 1);
      else {
        const p = preds.get(n)!.map((a) => rank.get(a.s)!);
        rank.set(n, (p.length ? Math.max(...p) : maxAct) + 1);
      }
    }
  }
  return rank;
}

function nodeScreenSize(n: LabNode, opts: LayoutOptions, horizontal: boolean): { w: number; h: number } {
  if (n.kind !== 'activity') {
    switch (opts.terminalStyle) {
      case 'dot':
        return { w: 12, h: 12 };
      case 'bar':
        return horizontal ? { w: 8, h: 36 } : { w: 36, h: 8 };
      case 'pill':
        return { w: Math.min(180, Math.max(60, n.label.length * CHAR_W + 30)), h: 24 };
      default:
        return { w: 26, h: 26 };
    }
  }
  if (opts.nodeStyle === 'minimal') {
    return { w: Math.min(240, n.label.length * CHAR_W + 26), h: opts.showFrequencies ? 34 : 24 };
  }
  const w = opts.fitNodeWidth ? Math.min(230, Math.max(90, n.label.length * CHAR_W + 32)) : 150;
  const h = opts.showFrequencies ? 44 : 34;
  return { w, h: opts.nodeStyle === 'pill' ? h - 4 : h };
}

function makeWidthScale(arcs: LabArc[], opts: LayoutOptions) {
  const maxAll = Math.max(1, ...arcs.map((a) => a.weight));
  const maxType = new Map<string, number>();
  const sortedAll = arcs.map((a) => a.weight).sort((a, b) => a - b);
  const sortedType = new Map<string, number[]>();
  for (const a of arcs) {
    maxType.set(a.type, Math.max(maxType.get(a.type) ?? 1, a.weight));
    const list = sortedType.get(a.type) ?? [];
    list.push(a.weight);
    sortedType.set(a.type, list);
  }
  sortedType.forEach((l) => l.sort((a, b) => a - b));
  return (w: number, type: string) => {
    const per = opts.widthNormalization === 'perType';
    const M = per ? maxType.get(type) ?? maxAll : maxAll;
    let f: number;
    switch (opts.widthScale) {
      case 'constant':
        f = 1;
        break;
      case 'linear':
        f = w / M;
        break;
      case 'log':
        f = Math.log1p(w) / Math.log1p(M);
        break;
      case 'rank': {
        const list = per ? sortedType.get(type) ?? sortedAll : sortedAll;
        let i = 0;
        while (i < list.length && list[i] < w) i++;
        f = list.length > 1 ? i / (list.length - 1) : 1;
        break;
      }
      default:
        f = Math.sqrt(w) / Math.sqrt(M);
    }
    f = Math.max(0, Math.min(1.5, f));
    return opts.minWidth + (opts.maxWidth - opts.minWidth) * Math.min(1, f) + Math.max(0, f - 1) * opts.maxWidth * 0.3;
  };
}

function mergedWidth(widths: number[], opts: LayoutOptions) {
  return Math.min(opts.maxWidth * 1.6, Math.sqrt(widths.reduce((s, w) => s + w * w, 0)));
}

function emptyResult(notes: string[], started: number): LayoutResult {
  return {
    nodes: [],
    arcs: [],
    trunks: [],
    junctions: [],
    selfLoops: [],
    lanes: [],
    rankLines: [],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    laneOrder: [],
    typeSummaries: [],
    metrics: { crossings: 0, overlaps: 0, nodeHits: 0, totalLength: 0, bends: 0, backArcs: 0, width: 0, height: 0, ms: Math.round(now() - started) },
    notes,
  };
}
