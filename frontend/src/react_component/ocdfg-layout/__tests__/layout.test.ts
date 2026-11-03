import { describe, expect, it } from 'vitest';
import { describeBlock, detectBlocks, fromProcessTree, linearize, orderFlowers } from '../blocks';
import { EXAMPLES } from './fixtures';
import { greedyFasOrder, dfsOrder, springRankOrder, bfsOrder } from '../flow';
import { filterGraph, fromBackendDfg, fromTraces } from '../graph';
import { computeLayout } from '../layout';
import { centerOut, orderLanes } from '../lanes';
import { ASPECTS, DEFAULT_OPTIONS, PRESETS, randomOptions, withDefaults } from '../options';
import type { LabGraph, LayoutOptions } from '../types';

function subOf(graph: LabGraph, type: string) {
  const acts = graph.nodes.filter((n) => n.kind === 'activity' && n.types.includes(type)).map((n) => n.id);
  const set = new Set(acts);
  const arcs = graph.arcs
    .filter((a) => a.type === type && set.has(a.source) && set.has(a.target) && a.source !== a.target)
    .map((a) => ({ s: a.source, t: a.target, w: a.weight }));
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  for (const a of graph.arcs) {
    if (a.type !== type) continue;
    if (a.source.startsWith('__start__')) starts.set(a.target, (starts.get(a.target) ?? 0) + a.weight);
    if (a.target.startsWith('__end__')) ends.set(a.source, (ends.get(a.source) ?? 0) + a.weight);
  }
  return { acts, arcs, starts, ends };
}

/** Deterministic pseudo random numbers for reproducible option sampling. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('flow orders', () => {
  const input = {
    nodes: ['S', 'a', 'b', 'c', 'E'],
    arcs: [
      { s: 'S', t: 'a', w: 10 },
      { s: 'a', t: 'b', w: 10 },
      { s: 'b', t: 'c', w: 10 },
      { s: 'c', t: 'b', w: 2 },
      { s: 'c', t: 'E', w: 10 },
    ],
    first: ['S'],
    last: ['E'],
  };
  it.each([
    ['greedyFas', greedyFasOrder],
    ['dfs', dfsOrder],
    ['springRank', springRankOrder],
    ['bfs', bfsOrder],
  ])('%s keeps the main flow forward and the light loop backward', (_name, fn) => {
    const order = fn(input);
    expect(order).toEqual(['S', 'a', 'b', 'c', 'E']);
  });
});

describe('light block detection', () => {
  it('finds sequence, choice and a redo loop', () => {
    const g = fromTraces({
      x: [
        [['a', 'b', 'd'], 5],
        [['a', 'c', 'd'], 4],
        [['a', 'c', 'e', 'c', 'd'], 2],
      ],
    });
    const block = detectBlocks(subOf(g, 'x'));
    // The c-branch carries more objects (6 vs 5), so it is the main branch.
    expect(describeBlock(block)).toBe('→(a, ×(↺(c, e), b), d)');
  });

  it('finds parallel branches', () => {
    const g = fromTraces({
      x: [
        [['a', 'b', 'c', 'd'], 5],
        [['a', 'c', 'b', 'd'], 5],
      ],
    });
    expect(describeBlock(detectBlocks(subOf(g, 'x')))).toBe('→(a, ∧(b, c), d)');
  });

  it('finds a loop with a silent redo', () => {
    const g = fromTraces({
      x: [
        [['a', 'b', 'c'], 5],
        [['a', 'b', 'c', 'a', 'b', 'c'], 2],
      ],
    });
    expect(describeBlock(detectBlocks(subOf(g, 'x')))).toBe('↺(→(a, b, c), τ)');
  });

  it('ignores noise arcs with the IMf threshold', () => {
    const g = fromTraces({
      x: [
        [['a', 'b', 'c'], 100],
        [['a', 'c', 'b'], 1],
      ],
    });
    expect(describeBlock(detectBlocks(subOf(g, 'x'), 0))).not.toBe('→(a, b, c)');
    expect(describeBlock(detectBlocks(subOf(g, 'x'), 0.1))).toBe('→(a, b, c)');
  });

  it('imports inductive-miner trees and prunes missing activities', () => {
    const tree = {
      operator: 'sequence' as const,
      label: null,
      children: [
        { operator: null, label: 'a', children: [] },
        {
          operator: 'loop' as const,
          label: null,
          children: [
            { operator: null, label: null, children: [] },
            { operator: null, label: 'b', children: [] },
            { operator: null, label: 'c', children: [] },
          ],
        },
        { operator: null, label: 'gone', children: [] },
      ],
    };
    const block = fromProcessTree(tree, new Set(['a', 'b', 'c', 'extra']));
    expect(describeBlock(block)).toBe('→(→(a, ✿(b, c)), extra)');
    expect(linearize(block)).toEqual(['a', 'b', 'c', 'extra']);
  });
});

describe('inductive-miner flowers', () => {
  it('orders flower activities along the DFG', () => {
    const g = fromTraces({ x: [[['a', 'b', 'c'], 10], [['a', 'c', 'b', 'c'], 1]] });
    const tree = {
      operator: 'loop' as const,
      label: null,
      children: [
        { operator: null, label: null, children: [] },
        { operator: null, label: 'c', children: [] },
        { operator: null, label: 'b', children: [] },
        { operator: null, label: 'a', children: [] },
      ],
    };
    const block = orderFlowers(fromProcessTree(tree, new Set(['a', 'b', 'c'])), subOf(g, 'x'));
    expect(linearize(block)).toEqual(['a', 'b', 'c']);
  });
});

describe('lane orders', () => {
  it('centre-out puts the best in the middle', () => {
    expect(centerOut(['a', 'b', 'c', 'd', 'e'], (t) => ({ a: 5, b: 4, c: 3, d: 2, e: 1 })[t]!)).toEqual([
      'd',
      'b',
      'a',
      'c',
      'e',
    ]);
  });

  it('keeps types sharing activities next to each other', () => {
    const g = fromTraces({
      a: [[['x', 'y'], 1]],
      b: [[['p', 'q'], 1]],
      c: [[['x', 'p'], 1]],
    });
    const typeActivities = new Map<string, Map<string, number>>();
    const activityTypes = new Map<string, string[]>();
    for (const n of g.nodes) {
      if (n.kind !== 'activity') continue;
      activityTypes.set(n.id, n.types);
      n.types.forEach((t) => {
        const m = typeActivities.get(t) ?? new Map();
        m.set(n.id, 1);
        typeActivities.set(t, m);
      });
    }
    const { order } = orderLanes('similarity', {
      types: g.types,
      typeActivities,
      activityTypes,
      arcs: [],
      terminalType: new Map(),
      objects: new Map(),
      rankSpan: new Map(),
    });
    expect(order[1]).toBe('c');
  });
});

describe('graph conversion', () => {
  it('reads the backend payload', () => {
    const g = fromBackendDfg({
      nodes: [
        { id: '__start__:o', role: 'start', object_type: 'o', types: ['o'] },
        { id: 'A', label: 'A', types: ['o'], metrics: { frequency: 3 } },
        { id: '__end__:o', role: 'end', object_type: 'o', types: ['o'] },
      ],
      links: [
        { source: '__start__:o', target: 'A', key: 'o', weight: 3, variant_rank: 1 },
        { source: 'A', target: '__end__:o', key: 'o', weight: 3, variant_rank: 1 },
      ],
    });
    expect(g.types).toEqual(['o']);
    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'activity', 'end']);
    expect(g.arcs).toHaveLength(2);
  });

  it('filters by variant coverage and hidden types', () => {
    const g = EXAMPLES[0].build();
    const filtered = filterGraph(g, ['customer'], 0.3);
    expect(filtered.types).not.toContain('customer');
    expect(filtered.arcs.length).toBeLessThan(g.arcs.length);
  });
});

describe('computeLayout', () => {
  it.each(EXAMPLES.map((e) => [e.id, e]))('lays out %s without overlapping nodes', (_id, example) => {
    const result = computeLayout(example.build(), DEFAULT_OPTIONS);
    expect(result.nodes.length).toBeGreaterThan(0);
    // No two nodes overlap.
    for (let i = 0; i < result.nodes.length; i++) {
      for (let j = i + 1; j < result.nodes.length; j++) {
        const a = result.nodes[i];
        const b = result.nodes[j];
        const overlapX = Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 0.5;
        const overlapY = Math.abs(a.y - b.y) < (a.height + b.height) / 2 - 0.5;
        expect(overlapX && overlapY, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
    for (const arc of result.arcs) {
      for (const p of arc.points) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it.each(['TB', 'LR', 'BT', 'RL'] as const)('keeps every lane title clear of the nodes (%s)', (direction) => {
    for (const example of EXAMPLES) {
      for (const rankGap of [24, DEFAULT_OPTIONS.rankGap]) {
        const result = computeLayout(example.build(), { ...DEFAULT_OPTIONS, direction, rankGap });
        for (const lane of result.lanes) {
          const { x, y, anchor, width, height } = lane.label;
          const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
          const box = { left, right: left + width, top: y - height / 2, bottom: y + height / 2 };
          for (const n of result.nodes) {
            const hit =
              box.left < n.x + n.width / 2 &&
              box.right > n.x - n.width / 2 &&
              box.top < n.y + n.height / 2 &&
              box.bottom > n.y - n.height / 2;
            expect(hit, `${example.id} ${direction} gap ${rankGap}: title ${lane.type} covers ${n.id}`).toBe(false);
          }
          // The title lies inside its lane band.
          expect(box.left >= lane.x - 0.5 && box.right <= lane.x + lane.width + 0.5, `${lane.type} inside its band`).toBe(true);
        }
      }
    }
  });

  it('routes main flows downwards and loops back up', () => {
    const result = computeLayout(EXAMPLES[2].build(), DEFAULT_OPTIONS);
    const y = new Map(result.nodes.map((n) => [n.id, n.y]));
    expect(y.get('open')!).toBeLessThan(y.get('triage')!);
    expect(y.get('work')!).toBeLessThan(y.get('test')!);
    expect(y.get('test')!).toBeLessThan(y.get('close')!);
    const testToWork = result.arcs.find((a) => a.source === 'test' && a.target === 'work');
    expect(testToWork?.cls).toBe('back');
  });

  it('every aspect value runs on every example', () => {
    for (const example of EXAMPLES) {
      const graph = example.build();
      for (const aspect of ASPECTS) {
        for (const choice of aspect.choices) {
          const opts = { ...DEFAULT_OPTIONS, [aspect.key]: choice.value } as LayoutOptions;
          const result = computeLayout(graph, opts);
          expect(result.nodes.length, `${example.id} ${aspect.key}=${choice.value}`).toBeGreaterThan(0);
          for (const arc of result.arcs) {
            expect(arc.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), `${example.id} ${aspect.key}=${choice.value} ${arc.id}`).toBe(true);
          }
        }
      }
    }
  });

  it('random combinations and presets run', () => {
    const random = rng(42);
    for (let i = 0; i < 60; i++) {
      const example = EXAMPLES[i % EXAMPLES.length];
      const opts = randomOptions(DEFAULT_OPTIONS, random);
      opts.mergePoints = random() > 0.5;
      const result = computeLayout(example.build(), opts);
      expect(result.nodes.length).toBeGreaterThan(0);
    }
    for (const preset of PRESETS) {
      for (const example of EXAMPLES) {
        expect(computeLayout(example.build(), withDefaults(preset.options)).nodes.length).toBeGreaterThan(0);
      }
    }
  });

  it.each(['bezier', 'orthogonal', 'octilinear', 'polyline', 'spline'] as const)(
    'never draws arcs on top of each other with %s routing',
    (edgeStyle) => {
      for (const example of EXAMPLES) {
        const result = computeLayout(example.build(), { ...DEFAULT_OPTIONS, edgeStyle });
        expect(result.metrics.overlaps, example.id).toBe(0);
      }
    },
  );

  it('keeps arcs out of nodes and avoids overlapping lines with the default options', () => {
    for (const example of EXAMPLES) {
      const result = computeLayout(example.build(), DEFAULT_OPTIONS);
      expect(result.metrics.overlaps, example.id).toBe(0);
      expect(result.metrics.nodeHits, example.id).toBe(0);
    }
  });
});
