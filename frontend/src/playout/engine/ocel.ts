/**
 * Serialization of playout variants to OCEL 2.0 JSON and to a plain
 * variants JSON file.
 *
 * Every variant becomes one process execution with its own fresh set of
 * objects (object ids are suffixed per variant), so the exported log's
 * object graph consists of perfectly disconnected components — one per
 * variant. Timestamps are deterministic: variants are one hour apart and
 * events within a variant one minute apart.
 */

import type { PlayoutVariant } from './types';

/** OCEL 2.0 JSON structure (matches totem_lib's import_ocel "json"). */
export type OcelJson = {
  objectTypes: { name: string; attributes: unknown[] }[];
  eventTypes: { name: string; attributes: unknown[] }[];
  objects: { id: string; type: string; attributes: unknown[]; relationships: unknown[] }[];
  events: {
    id: string;
    type: string;
    time: string;
    attributes: unknown[];
    relationships: { objectId: string; qualifier: string }[];
  }[];
};

const BASE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export function variantsToOcel(variants: readonly PlayoutVariant[]): OcelJson {
  const objectTypes = new Set<string>();
  const eventTypes = new Set<string>();
  const objects: OcelJson['objects'] = [];
  const events: OcelJson['events'] = [];

  variants.forEach((variant, v) => {
    // Fresh objects per variant: "<type>_<k>" -> "<type>_<variant>_<k>".
    const exportId = new Map<string, string>();
    for (const [ot, count] of Object.entries(variant.objectCounts)) {
      objectTypes.add(ot);
      for (let k = 1; k <= count; k++) {
        const id = `${ot}_${v + 1}_${k}`;
        exportId.set(`${ot}\u0001${ot}_${k}`, id);
        objects.push({ id, type: ot, attributes: [], relationships: [] });
      }
    }
    variant.events.forEach((event, i) => {
      eventTypes.add(event.activity);
      const relationships: { objectId: string; qualifier: string }[] = [];
      for (const ot of Object.keys(event.objects).sort()) {
        for (const obj of event.objects[ot]) {
          relationships.push({ objectId: exportId.get(`${ot}\u0001${obj}`)!, qualifier: ot });
        }
      }
      events.push({
        id: `e_${v + 1}_${i + 1}`,
        type: event.activity,
        time: new Date(BASE_TIME_MS + v * HOUR_MS + i * MINUTE_MS).toISOString(),
        attributes: [],
        relationships,
      });
    });
  });

  return {
    objectTypes: [...objectTypes].sort().map((name) => ({ name, attributes: [] })),
    eventTypes: [...eventTypes].sort().map((name) => ({ name, attributes: [] })),
    objects,
    events,
  };
}

/** Self-describing variants file (one entry per object-centric variant). */
export function variantsToJson(
  variants: readonly PlayoutVariant[],
  meta: {
    modelName: string;
    modelFormat: 'ocpn' | 'occn';
    objectsPerType: Record<string, number>;
    activityLimits: Record<string, number>;
    variantCount: number;
    exhaustive: boolean;
  },
) {
  return {
    format: 'oc-playout-variants',
    version: 1,
    model: { name: meta.modelName, format: meta.modelFormat },
    parameters: {
      objectsPerType: meta.objectsPerType,
      activityLimits: meta.activityLimits,
    },
    totalVariantCount: meta.variantCount,
    countIsExact: meta.exhaustive,
    variants: variants.map((variant) => ({
      objectCounts: variant.objectCounts,
      events: variant.events.map((event) => ({
        activity: event.activity,
        objects: event.objects,
      })),
    })),
  };
}
