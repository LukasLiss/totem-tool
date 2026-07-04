import { describe, expect, it } from 'vitest';
import { variantsToOcel } from '../ocel';
import type { PlayoutVariant } from '../types';

const variantA: PlayoutVariant = {
  events: [
    { activity: 'pack', visible: true, objects: { item: ['item_1', 'item_2'] } },
    { activity: 'ship', visible: true, objects: { item: ['item_1', 'item_2'], order: ['order_1'] } },
  ],
  objectCounts: { item: 2, order: 1 },
};
const variantB: PlayoutVariant = {
  events: [
    { activity: 'pack', visible: true, objects: { item: ['item_1'] } },
    { activity: 'pack', visible: true, objects: { item: ['item_2'] } },
    { activity: 'ship', visible: true, objects: { item: ['item_1', 'item_2'], order: ['order_1'] } },
  ],
  objectCounts: { item: 2, order: 1 },
};

describe('variantsToOcel', () => {
  it('gives every variant its own disconnected set of objects', () => {
    const ocel = variantsToOcel([variantA, variantB]);

    expect(ocel.objectTypes.map((t) => t.name)).toEqual(['item', 'order']);
    expect(ocel.eventTypes.map((t) => t.name)).toEqual(['pack', 'ship']);
    // 3 objects per variant, ids namespaced by variant.
    expect(ocel.objects.map((o) => o.id).sort()).toEqual(
      ['item_1_1', 'item_1_2', 'order_1_1', 'item_2_1', 'item_2_2', 'order_2_1'].sort(),
    );

    // Every event relationship must reference an existing object of the
    // event's own variant — the object graph has one component per variant.
    const objectIds = new Set(ocel.objects.map((o) => o.id));
    for (const event of ocel.events) {
      const variantOfEvent = event.id.split('_')[1];
      expect(event.relationships.length).toBeGreaterThan(0);
      for (const rel of event.relationships) {
        expect(objectIds.has(rel.objectId)).toBe(true);
        const variantOfObject = rel.objectId.split('_').at(-2);
        expect(variantOfObject).toBe(variantOfEvent);
      }
    }

    // Timestamps increase within a variant and across variants.
    const times = ocel.events.map((e) => e.time);
    expect([...times].sort()).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
  });
});
