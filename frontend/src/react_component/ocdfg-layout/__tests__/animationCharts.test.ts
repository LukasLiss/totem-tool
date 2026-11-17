import { describe, expect, it } from 'vitest';
import { ageAt, computeAgeSeries, computeBalanceSeries, computeObjectSeries, objectsAt } from '../animationCharts';
import { decodeFlows, type FlowsPayload } from '../tokenAnimation';

/**
 * o0 (order): 0 → 100, then a 0 s step at 100 (shown for 1 s).
 * o1, o2 (items): 0 → 50 and 20 → 80.
 */
const payload: FlowsPayload = {
  activities: ['a', 'b', 'c'],
  object_types: ['item', 'order'],
  objects: { type: [1, 0, 0], variant_rank: null },
  flows: {
    object: [0, 1, 2, 0],
    source: [0, 0, 0, 1],
    target: [1, 1, 1, 2],
    start: [0, 0, 20, 100],
    duration: [100, 50, 60, 0],
  },
  total_objects: 3,
};
const tokens = decodeFlows(payload);
const all = new Uint8Array(tokens.count).fill(1);
const colors = { item: '#f00', order: '#00f' };

describe('objects between events', () => {
  it('counts distinct objects per type at an instant', () => {
    expect(objectsAt(tokens, all, 10)).toEqual({ order: 1, item: 1 });
    expect(objectsAt(tokens, all, 30)).toEqual({ order: 1, item: 2 });
    expect(objectsAt(tokens, all, 90)).toEqual({ order: 1 });
    // The 0 s step lifted to 1 s does not count the order twice.
    expect(objectsAt(tokens, all, 100)).toEqual({ order: 1 });
    expect(objectsAt(tokens, all, 101)).toEqual({});
  });

  it('draws one step curve per type in the colour map order', () => {
    const series = computeObjectSeries(tokens, all, colors);
    expect(series.kind).toBe('step');
    expect(series.lines.map((l) => l.key)).toEqual(['item', 'order']);
    expect(Math.max(...series.lines[0].points.map((p) => p.v))).toBe(2);
    // The order stays at 1 across its two steps (no dip at 100).
    expect(series.lines[1].points.map((p) => p.v)).toEqual([1, 0]);
  });

  it('counts only shown steps', () => {
    const onlyOrder = Uint8Array.from([1, 0, 0, 1]);
    expect(objectsAt(tokens, onlyOrder, 30)).toEqual({ order: 1 });
    expect(computeObjectSeries(tokens, onlyOrder, colors).lines.map((l) => l.key)).toEqual(['order']);
  });
});

describe('step balance', () => {
  it('sums to zero over the whole timeline', () => {
    const series = computeBalanceSeries(tokens, all);
    expect(series.kind).toBe('bars');
    expect(series.lines[0].points.reduce((s, p) => s + p.v, 0)).toBe(0);
    expect(series.footnote).toBe('1 min intervals');
  });
});

describe('time since last event', () => {
  it('averages over the objects between events', () => {
    // At 30: o0 for 30 s, o1 for 30 s, o2 for 10 s.
    expect(ageAt(tokens, all, 30)).toBeCloseTo(70 / 3);
    expect(Number.isNaN(ageAt(tokens, all, 500))).toBe(true);
    const series = computeAgeSeries(tokens, all);
    expect(series.kind).toBe('line');
    expect(series.format(90)).toBe('1m 30s');
  });
});
