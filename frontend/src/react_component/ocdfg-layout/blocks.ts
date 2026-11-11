/**
 * Block structure of an object type's DFG, inductive-miner style.
 *
 * The "light" detection runs the four inductive-miner cuts (exclusive choice,
 * sequence, parallel, loop) directly on the directly-follows graph and
 * recurses on *projected sub-DFGs* instead of split logs: the start and end
 * activities of a part are derived from the arcs crossing its border. Arcs
 * lighter than `noise × heaviest outgoing arc` are ignored while looking for
 * a cut (like IMf). When no cut exists the part becomes a "flower" whose
 * activities are ordered by a greedy feedback arc set.
 *
 * Alternatively a process tree from the backend inductive miner (which does
 * split the log) can be imported with `fromProcessTree`.
 */
import { components, greedyFasOrder, stronglyConnected, type WArc } from './flow';
import type { Block, BranchPlacement, ProcessTreeJson } from './types';

export interface SubDfg {
  acts: string[];
  /** Arcs between activities of this part, self loops excluded. */
  arcs: WArc[];
  starts: Map<string, number>;
  ends: Map<string, number>;
}

const MAX_DEPTH = 40;

export function detectBlocks(sub: SubDfg, noise = 0, depth = 0): Block {
  const acts = sub.acts;
  if (acts.length === 0) return { kind: 'tau' };
  if (acts.length === 1) return { kind: 'leaf', activity: acts[0] };
  if (depth > MAX_DEPTH) return flower(sub);

  // Noise filtering for the cut search only.
  const maxOut = new Map<string, number>();
  for (const a of sub.arcs) maxOut.set(a.s, Math.max(maxOut.get(a.s) ?? 0, a.w));
  // Leaving the part counts as an outgoing arc too (like the end node in IMf).
  for (const [a, w] of sub.ends) maxOut.set(a, Math.max(maxOut.get(a) ?? 0, w));
  const filtered = sub.arcs.filter((a) => a.w >= noise * (maxOut.get(a.s) ?? 0));
  const has = arcLookup(filtered);
  const starts = significant(sub.starts, noise);
  const ends = significant(sub.ends, noise);

  // 1. Exclusive choice: disconnected parts.
  const xorGroups = components(acts, (a, b) => has(a, b));
  if (xorGroups.length > 1) {
    const children = xorGroups.map((g) => detectBlocks(project(sub, g), noise, depth + 1));
    return { kind: 'xor', children: sortBranches(children, xorGroups, sub) };
  }

  // 2. Sequence.
  const seqGroups = sequenceCut(acts, filtered);
  if (seqGroups) {
    const children = seqGroups.map((g, i) => detectBlocks(projectSequence(sub, seqGroups, i), noise, depth + 1));
    return { kind: 'seq', children };
  }

  // 3. Parallel.
  const parGroups = parallelCut(acts, has, starts, ends);
  if (parGroups) {
    const children = parGroups.map((g) => detectBlocks(project(sub, g), noise, depth + 1));
    return { kind: 'and', children: sortBranches(children, parGroups, sub) };
  }

  // 4. Loop.
  const loop = loopCut(acts, filtered, starts, ends);
  if (loop) {
    if (loop.redo.length > 0) {
      const bodySub = project(sub, loop.body);
      // The body keeps the start and end activities of the whole part.
      bodySub.starts = new Map([...sub.starts].filter(([a]) => loop.body.includes(a)));
      bodySub.ends = new Map([...sub.ends].filter(([a]) => loop.body.includes(a)));
      const body = detectBlocks(bodySub, noise, depth + 1);
      const redos = loop.redo.map((r) => detectBlocks(projectRedo(sub, loop.body, r), noise, depth + 1));
      const order = redos.map((_, i) => i).sort((a, b) => weightInto(sub, loop.redo[b]) - weightInto(sub, loop.redo[a]));
      return { kind: 'loop', children: [body, ...order.map((i) => redos[i])] };
    }
    // Loop with a silent redo: strip the loop-back arcs and look again.
    const back = new Set(loop.backArcs.map((a) => `${a.s}\u0001${a.t}`));
    const bodySub: SubDfg = { ...sub, arcs: sub.arcs.filter((a) => !back.has(`${a.s}\u0001${a.t}`)) };
    const body = detectBlocks(bodySub, noise, depth + 1);
    return { kind: 'loop', children: [body, { kind: 'tau' }] };
  }

  return flower(sub);
}

function arcLookup(arcs: WArc[]) {
  const set = new Set(arcs.map((a) => `${a.s}\u0001${a.t}`));
  return (a: string, b: string) => set.has(`${a}\u0001${b}`);
}

function significant(map: Map<string, number>, noise: number): Set<string> {
  const max = Math.max(0, ...map.values());
  const result = new Set([...map].filter(([, w]) => w >= noise * max).map(([a]) => a));
  if (result.size === 0) map.forEach((_, a) => result.add(a));
  return result;
}

function weightInto(sub: SubDfg, group: string[]) {
  const set = new Set(group);
  let w = 0;
  for (const a of sub.arcs) if (!set.has(a.s) && set.has(a.t)) w += a.w;
  for (const [a, sw] of sub.starts) if (set.has(a)) w += sw;
  return w;
}

function sortBranches(children: Block[], groups: string[][], sub: SubDfg): Block[] {
  const idx = children.map((_, i) => i);
  const first = groups.map((g) => [...g].sort()[0]);
  idx.sort((a, b) => weightInto(sub, groups[b]) - weightInto(sub, groups[a]) || first[a].localeCompare(first[b]));
  return idx.map((i) => children[i]);
}

/** Sequence cut via strongly connected components and reachability. */
function sequenceCut(acts: string[], arcs: WArc[]): string[][] | null {
  const sccs = stronglyConnected(acts, arcs);
  if (sccs.length < 2) return null;
  const compOf = new Map<string, number>();
  sccs.forEach((c, i) => c.forEach((a) => compOf.set(a, i)));
  const succ = sccs.map(() => new Set<number>());
  for (const a of arcs) {
    const i = compOf.get(a.s);
    const j = compOf.get(a.t);
    if (i !== undefined && j !== undefined && i !== j) succ[i].add(j);
  }
  const reach = sccs.map((_, i) => {
    const seen = new Set<number>();
    const stack = [...succ[i]];
    while (stack.length) {
      const j = stack.pop()!;
      if (seen.has(j)) continue;
      seen.add(j);
      succ[j].forEach((k) => stack.push(k));
    }
    return seen;
  });
  let groups = sccs.map((c, i) => ({ acts: [...c], ids: [i] }));
  const reaches = (g: { ids: number[] }, h: { ids: number[] }) => g.ids.some((i) => h.ids.some((j) => reach[i].has(j)));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (!reaches(groups[i], groups[j]) && !reaches(groups[j], groups[i])) {
          groups[i] = { acts: [...groups[i].acts, ...groups[j].acts], ids: [...groups[i].ids, ...groups[j].ids] };
          groups.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  if (groups.length < 2) return null;
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (reaches(groups[i], groups[j]) && reaches(groups[j], groups[i])) return null;
    }
  }
  groups = [...groups].sort((g, h) => {
    if (reaches(g, h)) return -1;
    if (reaches(h, g)) return 1;
    return 0;
  });
  // Bubble sort fallback to guarantee a consistent total order.
  for (let i = 0; i < groups.length; i++) {
    for (let j = 0; j < groups.length - 1; j++) {
      if (reaches(groups[j + 1], groups[j])) [groups[j], groups[j + 1]] = [groups[j + 1], groups[j]];
    }
  }
  return groups.map((g) => g.acts);
}

/** Parallel cut: parts that are fully connected in both directions. */
function parallelCut(
  acts: string[],
  has: (a: string, b: string) => boolean,
  starts: Set<string>,
  ends: Set<string>,
): string[][] | null {
  const groups = components(acts, (a, b) => a !== b && !(has(a, b) && has(b, a)));
  if (groups.length < 2) return null;
  const valid = groups.filter((g) => g.some((a) => starts.has(a)) && g.some((a) => ends.has(a)));
  const invalid = groups.filter((g) => !valid.includes(g));
  if (valid.length < 2) return null;
  if (invalid.length) valid[0] = [...valid[0], ...invalid.flat()];
  return valid;
}

function loopCut(acts: string[], arcs: WArc[], starts: Set<string>, ends: Set<string>) {
  const body = new Set([...starts, ...ends]);
  const rest = acts.filter((a) => !body.has(a));
  const has = arcLookup(arcs);
  const comps = components(rest, (a, b) => has(a, b));
  const redo: string[][] = [];
  for (const comp of comps) {
    const set = new Set(comp);
    let fromEnd = false;
    let toStart = false;
    let ok = true;
    for (const a of arcs) {
      const sIn = set.has(a.s);
      const tIn = set.has(a.t);
      if (!sIn && tIn) {
        if (ends.has(a.s)) fromEnd = true;
        else ok = false;
      }
      if (sIn && !tIn) {
        if (starts.has(a.t)) toStart = true;
        else ok = false;
      }
    }
    if (ok && fromEnd && toStart) redo.push(comp);
  }
  const redoActs = new Set(redo.flat());
  const bodyActs = acts.filter((a) => !redoActs.has(a));
  if (redo.length > 0) return { body: bodyActs, redo, backArcs: [] as WArc[] };
  const backArcs = arcs.filter(
    (a) => ends.has(a.s) && starts.has(a.t) && a.s !== a.t && !(starts.has(a.s) && ends.has(a.t)),
  );
  if (backArcs.length > 0 && acts.length > 1) return { body: acts, redo: [] as string[][], backArcs };
  return null;
}

/** Projection for exclusive and parallel branches and loop bodies. */
function project(sub: SubDfg, group: string[]): SubDfg {
  const set = new Set(group);
  const arcs = sub.arcs.filter((a) => set.has(a.s) && set.has(a.t));
  const starts = new Map([...sub.starts].filter(([a]) => set.has(a)));
  const ends = new Map([...sub.ends].filter(([a]) => set.has(a)));
  return withFallbackTerminals({ acts: group, arcs, starts, ends });
}

function projectSequence(sub: SubDfg, groups: string[][], index: number): SubDfg {
  const group = groups[index];
  const set = new Set(group);
  const before = new Set(groups.slice(0, index).flat());
  const after = new Set(groups.slice(index + 1).flat());
  const starts = new Map([...sub.starts].filter(([a]) => set.has(a)));
  const ends = new Map([...sub.ends].filter(([a]) => set.has(a)));
  for (const a of sub.arcs) {
    if (before.has(a.s) && set.has(a.t)) starts.set(a.t, (starts.get(a.t) ?? 0) + a.w);
    if (set.has(a.s) && after.has(a.t)) ends.set(a.s, (ends.get(a.s) ?? 0) + a.w);
  }
  const arcs = sub.arcs.filter((a) => set.has(a.s) && set.has(a.t));
  return withFallbackTerminals({ acts: group, arcs, starts, ends });
}

function projectRedo(sub: SubDfg, body: string[], redo: string[]): SubDfg {
  const set = new Set(redo);
  const bodySet = new Set(body);
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  for (const a of sub.arcs) {
    if (bodySet.has(a.s) && set.has(a.t)) starts.set(a.t, (starts.get(a.t) ?? 0) + a.w);
    if (set.has(a.s) && bodySet.has(a.t)) ends.set(a.s, (ends.get(a.s) ?? 0) + a.w);
  }
  const arcs = sub.arcs.filter((a) => set.has(a.s) && set.has(a.t));
  return withFallbackTerminals({ acts: redo, arcs, starts, ends });
}

function withFallbackTerminals(sub: SubDfg): SubDfg {
  if (sub.starts.size === 0) {
    const noPred = sub.acts.filter((a) => !sub.arcs.some((x) => x.t === a && x.s !== a));
    (noPred.length ? noPred : [sub.acts[0]]).forEach((a) => sub.starts.set(a, 1));
  }
  if (sub.ends.size === 0) {
    const noSucc = sub.acts.filter((a) => !sub.arcs.some((x) => x.s === a && x.t !== a));
    (noSucc.length ? noSucc : [sub.acts[sub.acts.length - 1]]).forEach((a) => sub.ends.set(a, 1));
  }
  return sub;
}

function flower(sub: SubDfg): Block {
  const S = '\u0000start';
  const E = '\u0000end';
  const arcs: WArc[] = [
    ...sub.arcs,
    ...[...sub.starts].map(([a, w]) => ({ s: S, t: a, w })),
    ...[...sub.ends].map(([a, w]) => ({ s: a, t: E, w })),
  ];
  const order = greedyFasOrder({ nodes: [S, ...sub.acts, E], arcs, first: [S], last: [E] }).filter(
    (n) => n !== S && n !== E,
  );
  return { kind: 'flower', children: order.map((a) => ({ kind: 'leaf', activity: a })) };
}

// ---------------------------------------------------------------------------
// Process trees from the backend inductive miner
// ---------------------------------------------------------------------------

export function fromProcessTree(tree: ProcessTreeJson, present: Set<string>): Block {
  const convert = (t: ProcessTreeJson): Block => {
    if (!t.operator) {
      return t.label && present.has(t.label) ? { kind: 'leaf', activity: t.label } : { kind: 'tau' };
    }
    const children = t.children.map(convert);
    if (t.operator === 'loop') {
      const [body, ...redo] = children;
      if (!body || body.kind === 'tau') {
        // IM's flower model: ↺(τ, a, b, …).
        const leaves = redo.flatMap(linearize).map((a): Block => ({ kind: 'leaf', activity: a }));
        return leaves.length > 1 ? { kind: 'flower', children: leaves } : leaves[0] ?? { kind: 'tau' };
      }
      const realRedo = redo.filter((r) => r.kind !== 'tau');
      return { kind: 'loop', children: [body, ...(realRedo.length ? realRedo : [{ kind: 'tau' } as Block])] };
    }
    const kind = t.operator === 'sequence' ? 'seq' : t.operator === 'xor' ? 'xor' : 'and';
    const real = children.filter((c) => c.kind !== 'tau');
    if (real.length === 0) return { kind: 'tau' };
    if (real.length === 1) return real[0];
    return { kind, children: real };
  };
  const block = convert(tree);
  const missing = [...present].filter((a) => !linearize(block).includes(a));
  if (missing.length === 0) return block;
  const extra: Block =
    missing.length === 1
      ? { kind: 'leaf', activity: missing[0] }
      : { kind: 'flower', children: missing.map((a) => ({ kind: 'leaf', activity: a })) };
  return block.kind === 'tau' ? extra : { kind: 'seq', children: [block, extra] };
}

/**
 * Order the activities of every flower block along the type's DFG (greedy
 * feedback arc set), so unstructured parts still follow the main flow. The
 * inductive miner lists flower activities in no meaningful order.
 */
export function orderFlowers(block: Block, sub: SubDfg): Block {
  if (block.kind === 'leaf' || block.kind === 'tau') return block;
  if (block.kind !== 'flower') return { ...block, children: block.children.map((c) => orderFlowers(c, sub)) };
  const acts = linearize(block);
  const set = new Set(acts);
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  for (const [a, w] of sub.starts) if (set.has(a)) starts.set(a, (starts.get(a) ?? 0) + w);
  for (const [a, w] of sub.ends) if (set.has(a)) ends.set(a, (ends.get(a) ?? 0) + w);
  for (const a of sub.arcs) {
    if (!set.has(a.s) && set.has(a.t)) starts.set(a.t, (starts.get(a.t) ?? 0) + a.w);
    if (set.has(a.s) && !set.has(a.t)) ends.set(a.s, (ends.get(a.s) ?? 0) + a.w);
  }
  return flower({ acts, arcs: sub.arcs.filter((a) => set.has(a.s) && set.has(a.t)), starts, ends });
}

// ---------------------------------------------------------------------------
// Using a block tree
// ---------------------------------------------------------------------------

/** Activities in block order: sequence order, loop body before the redo parts. */
export function linearize(block: Block): string[] {
  if (block.kind === 'leaf') return [block.activity];
  if (block.kind === 'tau') return [];
  return block.children.flatMap(linearize);
}

const SYMBOL: Record<string, string> = { seq: '→', xor: '×', and: '∧', loop: '↺', flower: '✿' };

export function describeBlock(block: Block, maxLength = 400): string {
  const go = (b: Block): string => {
    if (b.kind === 'leaf') return b.activity;
    if (b.kind === 'tau') return 'τ';
    return `${SYMBOL[b.kind]}(${b.children.map(go).join(', ')})`;
  };
  const text = go(block);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

type PathStep = { block: Block; child: number };

/** Path from the root to every activity: the block and child index at each level. */
export function blockPaths(block: Block): Map<string, PathStep[]> {
  const result = new Map<string, PathStep[]>();
  const walk = (b: Block, path: PathStep[]) => {
    if (b.kind === 'leaf') result.set(b.activity, path);
    else if (b.kind !== 'tau') b.children.forEach((c, i) => walk(c, [...path, { block: b, child: i }]));
  };
  walk(block, []);
  return result;
}

/** True when s and t lie in different branches of the same parallel block. */
export function isInterleave(paths: Map<string, PathStep[]>, s: string, t: string): boolean {
  const ps = paths.get(s);
  const pt = paths.get(t);
  if (!ps || !pt) return false;
  let i = 0;
  while (i < ps.length && i < pt.length && ps[i].block === pt[i].block && ps[i].child === pt[i].child) i++;
  return i < ps.length && i < pt.length && ps[i].block === pt[i].block && ps[i].block.kind === 'and';
}

export interface Extents {
  left: number;
  right: number;
  offsets: Map<string, number>;
}

/**
 * Cross-axis offsets (in columns) of the activities of a block tree relative
 * to the lane axis: sequences stack on the axis, branches of choices and
 * parallel blocks go side by side, redo parts of loops break out to `side`.
 */
export function blockExtents(block: Block, placement: BranchPlacement, side: 1 | -1): Extents {
  const go = (b: Block): Extents => {
    if (b.kind === 'leaf') return { left: 0.5, right: 0.5, offsets: new Map([[b.activity, 0]]) };
    if (b.kind === 'tau') return { left: 0, right: 0, offsets: new Map() };
    const kids = b.children.map(go);
    if (b.kind === 'seq' || b.kind === 'flower' || placement === 'none') {
      return stackAligned(kids);
    }
    if (b.kind === 'loop') {
      const [body, ...redo] = kids;
      const res: Extents = { left: body.left, right: body.right, offsets: new Map(body.offsets) };
      for (const r of redo) {
        if (r.offsets.size === 0) continue;
        if (side > 0) {
          const anchor = res.right + r.left;
          r.offsets.forEach((v, a) => res.offsets.set(a, v + anchor));
          res.right = anchor + r.right;
        } else {
          const anchor = -(res.left + r.right);
          r.offsets.forEach((v, a) => res.offsets.set(a, v + anchor));
          res.left = -anchor + r.left;
        }
      }
      return res;
    }
    // xor / and
    const real = kids.filter((k) => k.offsets.size > 0);
    if (real.length === 0) return { left: 0, right: 0, offsets: new Map() };
    if (placement === 'centered') {
      const total = real.reduce((s, k) => s + k.left + k.right, 0);
      let cursor = -total / 2;
      const offsets = new Map<string, number>();
      for (const k of real) {
        const anchor = cursor + k.left;
        k.offsets.forEach((v, a) => offsets.set(a, v + anchor));
        cursor += k.left + k.right;
      }
      return { left: total / 2, right: total / 2, offsets };
    }
    // mainStraight: first (most frequent) branch on the axis, others alternate.
    const [main, ...others] = real;
    const res: Extents = { left: main.left, right: main.right, offsets: new Map(main.offsets) };
    others.forEach((k, i) => {
      const toRight = (i % 2 === 0) === side > 0;
      if (toRight) {
        const anchor = res.right + k.left;
        k.offsets.forEach((v, a) => res.offsets.set(a, v + anchor));
        res.right = anchor + k.right;
      } else {
        const anchor = -(res.left + k.right);
        k.offsets.forEach((v, a) => res.offsets.set(a, v + anchor));
        res.left = -anchor + k.left;
      }
    });
    return res;
  };
  return go(block);
}

function stackAligned(kids: Extents[]): Extents {
  const offsets = new Map<string, number>();
  let left = 0;
  let right = 0;
  for (const k of kids) {
    k.offsets.forEach((v, a) => offsets.set(a, v));
    left = Math.max(left, k.left);
    right = Math.max(right, k.right);
  }
  return { left, right, offsets };
}
