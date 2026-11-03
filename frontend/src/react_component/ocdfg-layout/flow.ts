/**
 * Main flow direction of a weighted directed graph.
 *
 * Every method returns a linear order of the nodes. Arcs pointing forward in
 * the order are the main flow; arcs pointing backwards are loops. The methods
 * differ in what they optimise (see the option hints in options.ts).
 */

export interface WArc {
  s: string;
  t: string;
  w: number;
}

export interface OrderInput {
  nodes: string[];
  arcs: WArc[];
  /** Nodes forced to the front (start nodes). */
  first?: string[];
  /** Nodes forced to the back (end nodes). */
  last?: string[];
}

function adjacency(nodes: string[], arcs: WArc[]) {
  const out = new Map<string, WArc[]>();
  const inn = new Map<string, WArc[]>();
  nodes.forEach((n) => {
    out.set(n, []);
    inn.set(n, []);
  });
  for (const a of arcs) {
    if (a.s === a.t) continue;
    if (!out.has(a.s) || !out.has(a.t)) continue;
    out.get(a.s)!.push(a);
    inn.get(a.t)!.push(a);
  }
  return { out, inn };
}

function splitPinned(input: OrderInput) {
  const first = (input.first ?? []).filter((n) => input.nodes.includes(n));
  const last = (input.last ?? []).filter((n) => input.nodes.includes(n) && !first.includes(n));
  const pinned = new Set([...first, ...last]);
  const free = input.nodes.filter((n) => !pinned.has(n));
  return { first, last, free };
}

/** Weighted Eades–Lin–Smyth heuristic for the minimum feedback arc set. */
export function greedyFasOrder(input: OrderInput): string[] {
  const { first, last, free } = splitPinned(input);
  const freeSet = new Set(free);
  const arcs = input.arcs.filter((a) => freeSet.has(a.s) && freeSet.has(a.t) && a.s !== a.t);
  const { out, inn } = adjacency(free, arcs);
  // Bias: arcs coming from the pinned start nodes make a node more "source-like".
  const bias = new Map<string, number>();
  for (const a of input.arcs) {
    if (first.includes(a.s) && freeSet.has(a.t)) bias.set(a.t, (bias.get(a.t) ?? 0) + a.w);
    if (last.includes(a.t) && freeSet.has(a.s)) bias.set(a.s, (bias.get(a.s) ?? 0) - a.w);
  }
  const remaining = new Set(free);
  const s1: string[] = [];
  const s2: string[] = [];
  const liveOut = (n: string) => out.get(n)!.filter((a) => remaining.has(a.t));
  const liveIn = (n: string) => inn.get(n)!.filter((a) => remaining.has(a.s));
  while (remaining.size > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of free) {
        if (!remaining.has(n)) continue;
        if (liveOut(n).length === 0) {
          s2.unshift(n);
          remaining.delete(n);
          changed = true;
        }
      }
      for (const n of free) {
        if (!remaining.has(n)) continue;
        if (liveIn(n).length === 0) {
          s1.push(n);
          remaining.delete(n);
          changed = true;
        }
      }
    }
    if (remaining.size === 0) break;
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const n of free) {
      if (!remaining.has(n)) continue;
      const score =
        liveOut(n).reduce((s, a) => s + a.w, 0) - liveIn(n).reduce((s, a) => s + a.w, 0) + (bias.get(n) ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    s1.push(best!);
    remaining.delete(best!);
  }
  return [...first, ...s1, ...s2, ...last];
}

/** Reverse post-order of a DFS from the start nodes, heaviest arcs first. */
export function dfsOrder(input: OrderInput): string[] {
  const { first, last, free } = splitPinned(input);
  const freeSet = new Set(free);
  const { out, inn } = adjacency(input.nodes, input.arcs);
  const visited = new Set<string>();
  const post: string[] = [];
  const visit = (root: string) => {
    if (visited.has(root) || !freeSet.has(root)) return;
    // Iterative DFS keeping an explicit iterator per node.
    const stack: Array<{ n: string; succ: string[]; i: number }> = [];
    const succOf = (n: string) =>
      [...out.get(n)!]
        .sort((a, b) => b.w - a.w)
        .map((a) => a.t)
        .filter((t) => freeSet.has(t));
    visited.add(root);
    stack.push({ n: root, succ: succOf(root), i: 0 });
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.i < top.succ.length) {
        const nxt = top.succ[top.i++];
        if (!visited.has(nxt)) {
          visited.add(nxt);
          stack.push({ n: nxt, succ: succOf(nxt), i: 0 });
        }
      } else {
        post.push(top.n);
        stack.pop();
      }
    }
  };
  // Roots: successors of the start nodes, heaviest first; then nodes without
  // predecessors; then everything else.
  const roots: string[] = [];
  for (const s of first) {
    [...out.get(s)!].sort((a, b) => b.w - a.w).forEach((a) => roots.push(a.t));
  }
  free.filter((n) => inn.get(n)!.every((a) => !freeSet.has(a.s))).forEach((n) => roots.push(n));
  roots.forEach(visit);
  free.forEach(visit);
  return [...first, ...post.reverse(), ...last];
}

/**
 * SpringRank: positions p minimising Σ w (p_t − p_s − 1)² with the start
 * nodes anchored at 0 (Gauss–Seidel), then sorted.
 */
export function springRankOrder(input: OrderInput, iterations = 300): string[] {
  const { first, last, free } = splitPinned(input);
  const { out, inn } = adjacency(input.nodes, input.arcs);
  const pos = new Map<string, number>();
  input.nodes.forEach((n) => pos.set(n, 0));
  // Start from the greedy order so ties resolve sensibly.
  const seed = greedyFasOrder(input);
  seed.forEach((n, i) => pos.set(n, i * 0.01));
  first.forEach((n) => pos.set(n, 0));
  // Only the start nodes are anchored; end nodes float so they cannot pull
  // their predecessors towards the start.
  const moving = [...free, ...last];
  for (let it = 0; it < iterations; it++) {
    for (const n of moving) {
      let num = 0;
      let den = 0;
      for (const a of inn.get(n)!) {
        num += a.w * (pos.get(a.s)! + 1);
        den += a.w;
      }
      for (const a of out.get(n)!) {
        num += a.w * (pos.get(a.t)! - 1);
        den += a.w;
      }
      if (den > 0) pos.set(n, num / den);
    }
  }
  const seedIndex = new Map(seed.map((n, i) => [n, i]));
  const sorted = [...free].sort((a, b) => pos.get(a)! - pos.get(b)! || seedIndex.get(a)! - seedIndex.get(b)!);
  return [...first, ...sorted, ...last];
}

/** Order by hop distance from the start nodes, ties by distance to the end. */
export function bfsOrder(input: OrderInput): string[] {
  const { first, last, free } = splitPinned(input);
  const { out, inn } = adjacency(input.nodes, input.arcs);
  const bfs = (sources: string[], next: (n: string) => string[]) => {
    const dist = new Map<string, number>();
    const queue = [...sources];
    sources.forEach((s) => dist.set(s, 0));
    while (queue.length) {
      const n = queue.shift()!;
      for (const m of next(n)) {
        if (!dist.has(m)) {
          dist.set(m, dist.get(n)! + 1);
          queue.push(m);
        }
      }
    }
    return dist;
  };
  const sources = first.length ? first : free.filter((n) => inn.get(n)!.length === 0);
  const sinks = last.length ? last : free.filter((n) => out.get(n)!.length === 0);
  const fromStart = bfs(sources, (n) => out.get(n)!.map((a) => a.t));
  const toEnd = bfs(sinks, (n) => inn.get(n)!.map((a) => a.s));
  const seedIndex = new Map(greedyFasOrder(input).map((n, i) => [n, i]));
  const key = (n: string) => fromStart.get(n) ?? 1e6;
  const sorted = [...free].sort(
    (a, b) =>
      key(a) - key(b) ||
      (toEnd.get(b) ?? 0) - (toEnd.get(a) ?? 0) ||
      seedIndex.get(a)! - seedIndex.get(b)!,
  );
  return [...first, ...sorted, ...last];
}

// ---------------------------------------------------------------------------
// Small graph helpers shared by the block detection
// ---------------------------------------------------------------------------

/** Tarjan's strongly connected components (iterative). */
export function stronglyConnected(nodes: string[], arcs: WArc[]): string[][] {
  const { out } = adjacency(nodes, arcs);
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  for (const root of nodes) {
    if (idx.has(root)) continue;
    const work: Array<{ n: string; i: number }> = [{ n: root, i: 0 }];
    idx.set(root, index);
    low.set(root, index);
    index++;
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const succ = out.get(frame.n)!;
      if (frame.i < succ.length) {
        const m = succ[frame.i++].t;
        if (!idx.has(m)) {
          idx.set(m, index);
          low.set(m, index);
          index++;
          stack.push(m);
          onStack.add(m);
          work.push({ n: m, i: 0 });
        } else if (onStack.has(m)) {
          low.set(frame.n, Math.min(low.get(frame.n)!, idx.get(m)!));
        }
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1].n;
          low.set(parent, Math.min(low.get(parent)!, low.get(frame.n)!));
        }
        if (low.get(frame.n) === idx.get(frame.n)) {
          const comp: string[] = [];
          let m: string;
          do {
            m = stack.pop()!;
            onStack.delete(m);
            comp.push(m);
          } while (m !== frame.n);
          result.push(comp);
        }
      }
    }
  }
  return result;
}

/** Connected components of the undirected graph given by `linked`. */
export function components(nodes: string[], linked: (a: string, b: string) => boolean): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const n of nodes) {
    if (seen.has(n)) continue;
    const comp: string[] = [];
    const queue = [n];
    seen.add(n);
    while (queue.length) {
      const cur = queue.shift()!;
      comp.push(cur);
      for (const m of nodes) {
        if (!seen.has(m) && (linked(cur, m) || linked(m, cur))) {
          seen.add(m);
          queue.push(m);
        }
      }
    }
    result.push(comp);
  }
  return result;
}
