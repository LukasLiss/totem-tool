/**
 * Variant-mode tests with hand-verified expectations.
 *
 * A variant is an isomorphism class of complete executions: executions
 * that differ only in the interleaving of independent events (events
 * sharing no object) or in the renaming of objects within a type are the
 * same variant. Events of the SAME object are always ordered, so two
 * parallel branches of one object still yield two variants — matching the
 * object-centric variant definition used in OCPM (per-object total order).
 */

import { describe, expect, it } from 'vitest';
import type { OcpnModelFile } from '../../../editors/shared/model-types';
import { createOccnEngine } from '../occn';
import { createOcpnEngine } from '../ocpn';
import { runPlayout } from '../search';
import type { PlayoutConfig } from '../types';
import { PARITY_FIXTURES } from './pythonParity.fixtures';

const config = (defaultLimit: number, overrides: Partial<PlayoutConfig> = {}): PlayoutConfig => ({
  mode: 'variants',
  objectsPerType: {},
  activityLimits: {},
  defaultActivityLimit: defaultLimit,
  timeoutMs: 30_000,
  maxStoredVariants: 10_000,
  maxStates: 10_000_000,
  ...overrides,
});

const ocpn = (
  places: OcpnModelFile['places'],
  transitions: OcpnModelFile['transitions'],
  arcs: [string, string, boolean?][],
  objectTypes: string[],
): OcpnModelFile => ({
  format: 'ocpn',
  version: 1,
  name: 'test',
  objectTypes: objectTypes.map((name) => ({ name })),
  places,
  transitions,
  arcs: arcs.map(([source, target, variable], i) => ({
    id: `a${i}`,
    source,
    target,
    ...(variable ? { variable: true } : {}),
  })),
});

const fixture = (name: string) => {
  const f = PARITY_FIXTURES.find((f) => f.name === name);
  if (!f) throw new Error(`fixture ${name} missing`);
  return f;
};

const occnEngine = (name: string, objects: Record<string, number>) =>
  createOccnEngine(
    {
      objectTypes: Object.keys(objects),
      markerGroups: fixture(name).markerGroups,
    },
    objects,
  );

describe('OCPN variants', () => {
  it('sequential net: one variant', () => {
    const model = ocpn(
      [
        { id: 'p1', objectType: 'order', initial: true },
        { id: 'p2', objectType: 'order', final: true },
      ],
      [{ id: 't1', label: 'place order' }],
      [
        ['p1', 't1'],
        ['t1', 'p2'],
      ],
      ['order'],
    );
    const result = runPlayout(createOcpnEngine(model, { order: 1 }), config(1));
    expect(result.exhaustive).toBe(true);
    expect(result.variantCount).toBe(1);
    expect(result.variants[0].events).toEqual([
      { activity: 'place order', visible: true, objects: { order: ['order_1'] } },
    ]);
  });

  it('xor split: two variants', () => {
    const model = ocpn(
      [
        { id: 'p1', objectType: 'order', initial: true },
        { id: 'p2', objectType: 'order', final: true },
      ],
      [
        { id: 'tA', label: 'A' },
        { id: 'tB', label: 'B' },
      ],
      [
        ['p1', 'tA'],
        ['tA', 'p2'],
        ['p1', 'tB'],
        ['tB', 'p2'],
      ],
      ['order'],
    );
    const result = runPlayout(createOcpnEngine(model, { order: 1 }), config(1));
    expect(result.variantCount).toBe(2);
  });

  it('parallel branches of the same object: two variants (per-object order matters)', () => {
    const model = ocpn(
      [
        { id: 'p0', objectType: 'order', initial: true },
        { id: 'pa', objectType: 'order' },
        { id: 'pb', objectType: 'order' },
        { id: 'qa', objectType: 'order' },
        { id: 'qb', objectType: 'order' },
        { id: 'pf', objectType: 'order', final: true },
      ],
      [
        { id: 'ts', label: 'split' },
        { id: 'tA', label: 'A' },
        { id: 'tB', label: 'B' },
        { id: 'tj', label: 'join' },
      ],
      [
        ['p0', 'ts'],
        ['ts', 'pa'],
        ['ts', 'pb'],
        ['pa', 'tA'],
        ['tA', 'qa'],
        ['pb', 'tB'],
        ['tB', 'qb'],
        ['qa', 'tj'],
        ['qb', 'tj'],
        ['tj', 'pf'],
      ],
      ['order'],
    );
    const result = runPlayout(createOcpnEngine(model, { order: 1 }), config(1));
    expect(result.exhaustive).toBe(true);
    expect(result.variantCount).toBe(2);
  });

  it('variable arc batching: batched vs one-by-one', () => {
    const model = ocpn(
      [
        { id: 'i1', objectType: 'item', initial: true },
        { id: 'i2', objectType: 'item', final: true },
      ],
      [{ id: 'tp', label: 'pack' }],
      [
        ['i1', 'tp', true],
        ['tp', 'i2', true],
      ],
      ['item'],
    );
    // pack twice allowed: {i1,i2} in one event, or one event per item
    // (the two one-by-one interleavings and object renamings collapse).
    const two = runPlayout(createOcpnEngine(model, { item: 2 }), config(2));
    expect(two.exhaustive).toBe(true);
    expect(two.variantCount).toBe(2);
    // pack once: only the batched execution completes.
    const once = runPlayout(createOcpnEngine(model, { item: 2 }), config(1));
    expect(once.variantCount).toBe(1);
    expect(once.variants[0].events).toEqual([
      { activity: 'pack', visible: true, objects: { item: ['item_1', 'item_2'] } },
    ]);
    // raw mode: 3 complete sequences ({both}, i1;i2, i2;i1).
    const raw = runPlayout(createOcpnEngine(model, { item: 2 }), {
      ...config(2),
      mode: 'raw',
    });
    expect(raw.completedRuns).toBe(3);
  });

  it('transition binding one order and a set of items', () => {
    const model = ocpn(
      [
        { id: 'op', objectType: 'order', initial: true },
        { id: 'oq', objectType: 'order', final: true },
        { id: 'ip', objectType: 'item', initial: true },
        { id: 'iq', objectType: 'item', final: true },
      ],
      [{ id: 'ts', label: 'ship' }],
      [
        ['op', 'ts'],
        ['ts', 'oq'],
        ['ip', 'ts', true],
        ['ts', 'iq', true],
      ],
      ['order', 'item'],
    );
    // The order can only ship once, so all items must ship together.
    const result = runPlayout(createOcpnEngine(model, { order: 1, item: 2 }), config(2));
    expect(result.exhaustive).toBe(true);
    expect(result.variantCount).toBe(1);
    expect(result.variants[0].events).toEqual([
      {
        activity: 'ship',
        visible: true,
        objects: { item: ['item_1', 'item_2'], order: ['order_1'] },
      },
    ]);
  });

  it('silent transitions fire but stay invisible', () => {
    const model = ocpn(
      [
        { id: 'p1', objectType: 'order', initial: true },
        { id: 'p2', objectType: 'order' },
        { id: 'p3', objectType: 'order', final: true },
      ],
      [
        { id: 't1', label: 'place order' },
        { id: 'tau', label: null, silent: true },
      ],
      [
        ['p1', 't1'],
        ['t1', 'p2'],
        ['p2', 'tau'],
        ['tau', 'p3'],
      ],
      ['order'],
    );
    const result = runPlayout(createOcpnEngine(model, { order: 1 }), config(1));
    expect(result.variantCount).toBe(1);
    expect(result.variants[0].events).toEqual([
      { activity: 'place order', visible: true, objects: { order: ['order_1'] } },
    ]);
  });
});

describe('OCCN variants', () => {
  it('occn_ABC: all interleavings and renamings collapse to one variant', () => {
    const result = runPlayout(occnEngine('occn_ABC', { order: 2 }), config(3));
    expect(result.exhaustive).toBe(true);
    // Raw playout has 252 sequences; they are all the same variant.
    expect(result.variantCount).toBe(1);
    expect(result.variants[0].events).toHaveLength(6);
    // Interleaving + symmetry pruning must cut the search drastically.
    expect(result.completedRuns).toBeLessThan(252);
  });

  it('occn_multi: batching structures = set partitions by size', () => {
    // 2 orders: a{o1,o2} or a{o1};a{o2} -> 2 variants.
    const two = runPlayout(occnEngine('occn_multi', { order: 2 }), config(3));
    expect(two.exhaustive).toBe(true);
    expect(two.variantCount).toBe(2);
    // 3 orders: batch sizes {3}, {2,1}, {1,1,1} -> 3 variants.
    const three = runPlayout(occnEngine('occn_multi', { order: 3 }), config(4));
    expect(three.exhaustive).toBe(true);
    expect(three.variantCount).toBe(3);
  });

  it('occn_basic: 64 raw sequences are a single variant', () => {
    const result = runPlayout(occnEngine('occn_basic', { order: 1, item: 2 }), config(3));
    expect(result.exhaustive).toBe(true);
    expect(result.variantCount).toBe(1);
    expect(result.variants[0].events).toEqual([
      {
        activity: 'a',
        visible: true,
        objects: { item: ['item_1', 'item_2'], order: ['order_1'] },
      },
    ]);
  });

  it('occn_start_parallel: XOR/AND start bindings give 4 variants', () => {
    // {a and b} in both orders (same object => ordered), {a}, {b}.
    const result = runPlayout(occnEngine('occn_start_parallel', { order: 1 }), config(3));
    expect(result.exhaustive).toBe(true);
    expect(result.variantCount).toBe(4);
  });
});
