import { describe, expect, it } from 'vitest';
import type { OccnModelFile, OcpnModelFile } from '@/editors/shared/model-types';
import {
  bumpAllLimits,
  limitRowsFor,
  variantsToJson,
  type PlayoutVariant,
} from '../model';

const ocpnModel = (transitions: OcpnModelFile['transitions']): OcpnModelFile => ({
  format: 'ocpn',
  version: 1,
  name: 'test net',
  objectTypes: [{ name: 'order' }],
  places: [],
  transitions,
  arcs: [],
});

const occnModel = (
  activities: string[],
  markerGroups: OccnModelFile['markerGroups'],
): OccnModelFile => ({
  format: 'occn',
  version: 1,
  name: 'test occn',
  objectTypes: [{ name: 'order' }, { name: 'item' }],
  activities: activities.map((name) => ({ name })),
  arcs: [],
  markerGroups,
});

describe('limitRowsFor', () => {
  it('gives OCPN silent transitions τ keys and dedups repeated labels', () => {
    const rows = limitRowsFor({
      format: 'ocpn',
      model: ocpnModel([
        { id: 't1', label: 'pack' },
        { id: 't2', label: 'pack' }, // same budget key as t1 → one row
        { id: 't3', label: 'route', silent: true }, // silent flag wins over label
        { id: 't4', label: null },
        { id: 't5', label: '' },
        { id: 't6', label: 'ship' },
      ]),
    });
    expect(new Map(rows.map((row) => [row.key, row.label]))).toEqual(
      new Map([
        ['pack', 'pack'],
        ['ship', 'ship'],
        ['τ:t3', 'τ (t3)'],
        ['τ:t4', 'τ (t4)'],
        ['τ:t5', 'τ (t5)'],
      ]),
    );
    expect(rows.map((row) => row.silent)).toEqual(
      rows.map((row) => row.key.startsWith('τ:')),
    );
    // Sorted by label.
    expect(rows.map((row) => row.label)).toEqual(
      [...rows.map((row) => row.label)].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('filters START_/END_ pseudo activities for OCCN and merges markerGroups keys', () => {
    const rows = limitRowsFor({
      format: 'occn',
      model: occnModel(['B', 'START_order', 'END_order', 'A'], {
        A: {}, // duplicate of the activity list entry
        C: {}, // only present in markerGroups
        START_item: {},
        END_item: {},
      }),
    });
    expect(rows).toEqual([
      { key: 'A', label: 'A', silent: false },
      { key: 'B', label: 'B', silent: false },
      { key: 'C', label: 'C', silent: false },
    ]);
  });
});

describe('bumpAllLimits', () => {
  it('increments every listed key and clamps at the maximum', () => {
    expect(bumpAllLimits({ a: 19, b: 20, c: 0 }, ['a', 'b', 'c'], 1, 0, 20)).toEqual({
      a: 20,
      b: 20,
      c: 1,
    });
  });

  it('decrements every listed key and clamps at the minimum', () => {
    expect(bumpAllLimits({ a: 0, b: 1, c: 5 }, ['a', 'b', 'c'], -1, 0, 20)).toEqual({
      a: 0,
      b: 0,
      c: 4,
    });
  });

  it('treats keys missing from the map as 0', () => {
    expect(bumpAllLimits({}, ['x', 'y'], 1, 0, 20)).toEqual({ x: 1, y: 1 });
    expect(bumpAllLimits({}, ['x'], -1, 0, 20)).toEqual({ x: 0 });
  });

  it('leaves keys outside the row list untouched and does not mutate the input', () => {
    const limits = { a: 5, stale: 7 };
    const next = bumpAllLimits(limits, ['a'], 1, 0, 20);
    expect(next).toEqual({ a: 6, stale: 7 });
    expect(limits).toEqual({ a: 5, stale: 7 });
  });
});

describe('variantsToJson', () => {
  it('produces the self-describing variants file shape', () => {
    const variants: PlayoutVariant[] = [
      {
        events: [
          { activity: 'pack', visible: true, objects: { order: ['order_1'] } },
          { activity: 'ship', visible: true, objects: { item: ['item_1'], order: ['order_1'] } },
        ],
        objectCounts: { order: 1, item: 1 },
      },
    ];
    const json = variantsToJson(variants, {
      modelName: 'test net',
      modelFormat: 'ocpn',
      objectsPerType: { order: 1, item: 1 },
      activityLimits: { pack: 2, ship: 1 },
      variantCount: 3,
      exhaustive: false,
    });
    expect(json).toEqual({
      format: 'oc-playout-variants',
      version: 1,
      model: { name: 'test net', format: 'ocpn' },
      parameters: {
        objectsPerType: { order: 1, item: 1 },
        activityLimits: { pack: 2, ship: 1 },
      },
      totalVariantCount: 3,
      countIsExact: false,
      variants: [
        {
          objectCounts: { order: 1, item: 1 },
          events: [
            { activity: 'pack', objects: { order: ['order_1'] } },
            { activity: 'ship', objects: { item: ['item_1'], order: ['order_1'] } },
          ],
        },
      ],
    });
    // The internal `visible` flag must not leak into the export.
    expect(json.variants[0].events[0]).not.toHaveProperty('visible');
  });
});
