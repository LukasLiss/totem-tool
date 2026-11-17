import { describe, expect, it } from 'vitest';
import { fromTraces } from '../graph';
import { computeLayout } from '../layout';
import { DEFAULT_OPTIONS } from '../options';
import {
  MIN_STEP_SECONDS,
  arcKey,
  arcPaths,
  decodeFlows,
  pointOnPath,
  tokensAt,
  type FlowsPayload,
  type TokenPath,
} from '../tokenAnimation';
import type { LayoutResult } from '../types';

/** o0, o1: orders; o2: item. Steps sorted by start. */
const payload: FlowsPayload = {
  activities: ['pack', 'pick', 'place', 'ship'],
  object_types: ['item', 'order'],
  objects: { type: [1, 1, 0], variant_rank: [1, 2, 1] },
  flows: {
    object: [0, 2, 1, 0],
    source: [2, 2, 2, 0],
    target: [0, 1, 0, 3],
    start: [0, 0, 10, 100],
    duration: [100, 50, 1000, 0],
  },
  total_objects: 3,
};

const straight = (x0: number, x1: number): TokenPath => ({ points: [{ x: x0, y: 0 }, { x: x1, y: 0 }], cumulative: [0, x1 - x0] });

describe('decodeFlows', () => {
  const tokens = decodeFlows(payload);

  it('keys every step by the layout arc id of its object type', () => {
    expect(tokens.arcKeys).toEqual([
      arcKey('place', 'pack', 'order'),
      arcKey('place', 'pick', 'item'),
      arcKey('pack', 'ship', 'order'),
    ]);
    expect(Array.from(tokens.arc)).toEqual([0, 1, 0, 2]);
  });

  it('keeps real durations and only lifts 0 s steps to the technical minimum', () => {
    expect(Array.from(tokens.duration)).toEqual([100, 50, 1000, MIN_STEP_SECONDS]);
    expect(tokens.longest).toBe(1000);
    expect(tokens.timeline).toEqual({ start: 0, end: 1010 });
  });

  it('sorts steps by start time if they arrive unsorted', () => {
    const shuffled: FlowsPayload = {
      ...payload,
      flows: {
        object: [0, 1, 2],
        source: [2, 2, 2],
        target: [0, 0, 1],
        start: [30, 10, 20],
        duration: [5, 5, 5],
      },
    };
    const t = decodeFlows(shuffled);
    expect(Array.from(t.start)).toEqual([10, 20, 30]);
    expect(Array.from(t.object)).toEqual([1, 2, 0]);
    expect(t.timeline).toEqual({ start: 10, end: 35 });
  });

  it('handles an empty payload', () => {
    const t = decodeFlows({ ...payload, objects: { type: [], variant_rank: null }, flows: { object: [], source: [], target: [], start: [], duration: [] } });
    expect(t.count).toBe(0);
    expect(tokensAt(t, [], 0)).toEqual([]);
  });
});

describe('tokensAt', () => {
  const tokens = decodeFlows(payload);
  const paths = [straight(0, 100), straight(0, 10), straight(0, 50)];

  it('places each running step at its share of the elapsed time', () => {
    expect(tokensAt(tokens, paths, 25)).toEqual([
      { x: 25, y: 0, type: 'order' }, // o0: 25 of 100 s
      { x: 5, y: 0, type: 'item' }, // o2: 25 of 50 s
      { x: 1.5, y: 0, type: 'order' }, // o1: 15 of 1000 s
    ]);
  });

  it('shows a step from its start up to (not including) its end', () => {
    expect(tokensAt(tokens, paths, 50).map((d) => d.type)).toEqual(['order', 'order']);
    // At 100, o0's first step has ended and its 0 s step is shown for the minimum.
    expect(tokensAt(tokens, paths, 100)).toContainEqual({ x: 0, y: 0, type: 'order' });
    expect(tokensAt(tokens, paths, 100 + MIN_STEP_SECONDS)).toHaveLength(1);
  });

  it('finds long steps that started long before', () => {
    // o1's 1000 s step started at 10 (890 of 1000 s along a 100 long arc), while the shorter ones have ended.
    expect(tokensAt(tokens, paths, 900)).toEqual([{ x: 89, y: 0, type: 'order' }]);
  });

  it('draws no token on arcs the layout does not draw', () => {
    expect(tokensAt(tokens, [null, straight(0, 10), null], 25)).toEqual([{ x: 5, y: 0, type: 'item' }]);
  });

  it('leaves out objects the caller hides (variant coverage)', () => {
    const rank = tokens.objectRank!;
    expect(tokensAt(tokens, paths, 25, (o) => rank[o] <= 1).map((d) => d.type)).toEqual(['order', 'item']);
  });
});

describe('pointOnPath', () => {
  it('walks polylines by length', () => {
    const path: TokenPath = {
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }],
      cumulative: [0, 10, 40],
    };
    expect(pointOnPath(path, 0)).toEqual({ x: 0, y: 0 });
    expect(pointOnPath(path, 0.25)).toEqual({ x: 10, y: 0 });
    expect(pointOnPath(path, 0.5)).toEqual({ x: 10, y: 10 });
    expect(pointOnPath(path, 1)).toEqual({ x: 10, y: 30 });
    expect(pointOnPath({ points: [{ x: 3, y: 4 }], cumulative: [0] }, 0.7)).toEqual({ x: 3, y: 4 });
  });
});

describe('arcPaths', () => {
  it('joins merge trunks to their arcs and covers self loops', () => {
    const result = {
      arcs: [{ id: 'a→b@t', points: [{ x: 10, y: 0 }, { x: 20, y: 0 }] }],
      trunks: [
        { arcs: ['a→b@t'], arrow: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
        { arcs: ['a→b@t'], arrow: true, points: [{ x: 20, y: 0 }, { x: 30, y: 0 }] },
      ],
      selfLoops: [
        { node: 'b', type: 't', points: [{ x: 0, y: 0 }, { x: 0, y: 5 }], center: { x: 1, y: 1 } },
        { node: 'c', type: 't', points: [], center: { x: 7, y: 8 } },
      ],
    } as unknown as LayoutResult;
    const paths = arcPaths(result);
    expect(paths.get('a→b@t')!.points.map((p) => p.x)).toEqual([0, 10, 10, 20, 20, 30]);
    expect(paths.get('b→b@t')!.points).toHaveLength(2);
    expect(pointOnPath(paths.get('c→c@t')!, 0.5)).toEqual({ x: 7, y: 8 });
  });

  it('has a path for every arc of a real layout, under the ids the steps use', () => {
    const graph = fromTraces({
      order: [[['place', 'pack', 'ship'], 3]],
      item: [[['place', 'pick', 'pick', 'pack'], 2]],
    });
    for (const options of [DEFAULT_OPTIONS, { ...DEFAULT_OPTIONS, mergePoints: true, bundling: 'merged' as const }]) {
      const result = computeLayout(graph, options);
      const paths = arcPaths(result);
      for (const a of result.arcs) expect(paths.get(a.id)?.points.length).toBeGreaterThan(1);
      expect(paths.has(arcKey('place', 'pack', 'order'))).toBe(true);
      expect(paths.has(arcKey('pick', 'pick', 'item'))).toBe(true);
    }
  });
});
