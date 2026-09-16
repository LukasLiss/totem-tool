import { describe, expect, it } from 'vitest';

import {
  assetToOccnModel,
  assetToTotemModel,
  occnModelToAsset,
  totemModelToAsset,
} from './asset-format';
import { buildOccnExample } from '../occn/model';
import { EXAMPLE_MODEL } from '../totem/example';
import { parseOccnModelFile, parseTotemModelFile } from './model-types';

// The canonical examples committed alongside totem_lib serialization: these are
// exactly what the miner / Python validator produce and accept.
import occnCanonical from '../../../../docs/examples/model-assets/occn-v1.json';
import totemCanonical from '../../../../docs/examples/model-assets/totem-v1.json';

// ---------------------------------------------------------------------------
// TOTeM
// ---------------------------------------------------------------------------

describe('TOTeM asset converter', () => {
  it('exports the canonical top-level shape', () => {
    const parsed = parseTotemModelFile(EXAMPLE_MODEL);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const asset = totemModelToAsset(parsed.model);
    expect(asset.schema).toBe('totem');
    expect(asset.version).toBe(1);
    expect(asset).toHaveProperty('tempgraph');
    expect(asset).toHaveProperty('cardinalities');
    expect(asset).toHaveProperty('type_relations');
    expect(asset).toHaveProperty('all_event_types', []);
    expect(asset).toHaveProperty('object_type_to_event_types', {});
    // Every temporal-relation key present, even when empty.
    for (const key of ['nodes', 'D', 'Di', 'I', 'Ii', 'P']) {
      expect(asset.tempgraph).toHaveProperty(key);
    }
  });

  it('uses the miner triple-dot cardinality spelling', () => {
    const parsed = parseTotemModelFile(EXAMPLE_MODEL);
    if (!parsed.ok) throw new Error('example did not parse');
    const asset = totemModelToAsset(parsed.model) as {
      cardinalities: Array<{ log_cardinality: string; event_cardinality: string }>;
    };
    const spellings = asset.cardinalities.flatMap((c) => [
      c.log_cardinality,
      c.event_cardinality,
    ]);
    // No double-dot 0..1 / 0..* survives to the stored format.
    expect(spellings.some((s) => s === '0..1' || s === '0..*')).toBe(false);
  });

  it('round-trips editor -> asset -> editor (model preserved)', () => {
    const parsed = parseTotemModelFile(EXAMPLE_MODEL);
    if (!parsed.ok) throw new Error('example did not parse');
    const original = parsed.model;

    const asset = totemModelToAsset(original);
    const { model: back, warnings } = assetToTotemModel(asset, original.name);

    expect(warnings).toEqual([]);
    // Same object types (order-independent).
    expect(new Set(back.objectTypes.map((t) => t.name))).toEqual(
      new Set(original.objectTypes.map((t) => t.name)),
    );
    // Same relations, comparing each direction's temporal code. Because the
    // editor stores one relation per pair, compare by unordered pair + the
    // temporal read in the stored orientation.
    const key = (r: { source: string; target: string; temporal: string }) => {
      const pair = [r.source, r.target].slice().sort().join('~');
      // Normalise the temporal to the sorted orientation.
      const sorted = r.source <= r.target;
      const t = sorted ? r.temporal : inverseTemporal(r.temporal);
      return `${pair}:${t}`;
    };
    expect(new Set(back.relations.map(key))).toEqual(new Set(original.relations.map(key)));
  });

  it('expands one editor relation to both directed miner edges', () => {
    const parsed = parseTotemModelFile(EXAMPLE_MODEL);
    if (!parsed.ok) throw new Error('example did not parse');
    const asset = totemModelToAsset(parsed.model) as {
      tempgraph: Record<string, string[][]>;
    };
    // Each editor relation with temporal T produces a T edge one way and the
    // inverse edge the other way — so total directed edges == 2 * relations.
    const totalEdges = ['D', 'Di', 'I', 'Ii', 'P'].reduce(
      (sum, k) => sum + (asset.tempgraph[k]?.length ?? 0),
      0,
    );
    expect(totalEdges).toBe(parsed.model.relations.length * 2);
  });

  it('collapses a consistent inverse pair back to one relation without warning', () => {
    // Order -> Item is D, Item -> Order is Di: a well-formed inverse pair.
    const asset = {
      schema: 'totem',
      version: 1,
      tempgraph: {
        nodes: ['Item', 'Order'],
        D: [['Order', 'Item']],
        Di: [['Item', 'Order']],
        I: [],
        Ii: [],
        P: [],
      },
      cardinalities: [],
      type_relations: [['Item', 'Order']],
      all_event_types: [],
      object_type_to_event_types: {},
    };
    const { model, warnings } = assetToTotemModel(asset, 'x');
    expect(warnings).toEqual([]);
    expect(model.relations).toHaveLength(1);
  });

  it('warns and keeps the more general relation on a mismatched pair', () => {
    // Order -> Item is D, Item -> Order is P (not the inverse of D): mismatch.
    const asset = {
      schema: 'totem',
      version: 1,
      tempgraph: {
        nodes: ['Item', 'Order'],
        D: [['Order', 'Item']],
        Di: [],
        I: [],
        Ii: [],
        P: [['Item', 'Order']],
      },
      cardinalities: [],
      type_relations: [['Item', 'Order']],
      all_event_types: [],
      object_type_to_event_types: {},
    };
    const { model, warnings } = assetToTotemModel(asset, 'x');
    expect(warnings).toHaveLength(1);
    expect(model.relations).toHaveLength(1);
    // P is more general than D, so the kept relation is P.
    expect(model.relations[0].temporal).toBe('P');
  });

  it('preserves positions and colors through layout', () => {
    const parsed = parseTotemModelFile(EXAMPLE_MODEL);
    if (!parsed.ok) throw new Error('example did not parse');
    const withLayout = {
      ...parsed.model,
      objectTypes: parsed.model.objectTypes.map((t, i) => ({
        ...t,
        color: '#123456',
        position: { x: i * 10, y: i * 20 },
      })),
    };
    const asset = totemModelToAsset(withLayout);
    expect(asset).toHaveProperty('layout');
    const { model: back } = assetToTotemModel(asset, withLayout.name);
    for (const t of withLayout.objectTypes) {
      const roundTripped = back.objectTypes.find((x) => x.name === t.name);
      expect(roundTripped?.color).toBe('#123456');
      expect(roundTripped?.position).toEqual(t.position);
    }
  });

  it('imports the committed canonical TOTeM example', () => {
    // The canonical example has D one way and P the other for the same pair,
    // which is a mismatch: the importer keeps the more general (P) and warns.
    const { model, warnings } = assetToTotemModel(totemCanonical, 'canonical');
    const reparsed = parseTotemModelFile(model);
    expect(reparsed.ok).toBe(true);
    expect(model.relations).toHaveLength(1);
    expect(model.relations[0].temporal).toBe('P');
    expect(warnings.length).toBeGreaterThan(0);
  });
});

/** Editor-side inverse used only by tests to normalise relation orientation. */
function inverseTemporal(t: string): string {
  return { D: 'Di', Di: 'D', I: 'Ii', Ii: 'I', P: 'P' }[t] ?? t;
}

// ---------------------------------------------------------------------------
// OCCN
// ---------------------------------------------------------------------------

describe('OCCN asset converter', () => {
  it('exports the canonical top-level shape', () => {
    const asset = occnModelToAsset(buildOccnExample());
    expect(asset.schema).toBe('occn');
    expect(asset.version).toBe(1);
    for (const key of [
      'activities',
      'object_types',
      'dependency_graph',
      'input_marker_groups',
      'output_marker_groups',
      'activity_count',
      'relative_occurrence_threshold',
    ]) {
      expect(asset).toHaveProperty(key);
    }
    expect(asset.relative_occurrence_threshold).toBe(0);
  });

  it('has an input/output marker-group entry for every activity', () => {
    const asset = occnModelToAsset(buildOccnExample()) as {
      activities: string[];
      input_marker_groups: Record<string, unknown>;
      output_marker_groups: Record<string, unknown>;
    };
    for (const activity of asset.activities) {
      expect(asset.input_marker_groups).toHaveProperty(activity);
      expect(asset.output_marker_groups).toHaveProperty(activity);
    }
  });

  it('resolves unbounded max (-1) to null', () => {
    const asset = occnModelToAsset(buildOccnExample()) as {
      input_marker_groups: Record<string, Array<{ markers: Array<{ max_count: number | null }> }>>;
    };
    const maxCounts = Object.values(asset.input_marker_groups)
      .flat()
      .flatMap((g) => g.markers.map((m) => m.max_count));
    // The example contains at least one unbounded (1,*) marker.
    expect(maxCounts).toContain(null);
  });

  it('round-trips editor -> asset -> editor (marker groups preserved)', () => {
    const original = buildOccnExample();
    const asset = occnModelToAsset(original);
    const back = assetToOccnModel(asset, original.name);

    // Same activities.
    expect(new Set(back.activities.map((a) => a.name))).toEqual(
      new Set(original.activities.map((a) => a.name)),
    );

    // Every original marker (related, objectType, min, resolvedMax) survives.
    const normalise = (
      groups: Record<string, { img?: unknown[][][]; omg?: unknown[][][] }>,
    ) => {
      const out: string[] = [];
      for (const [activity, bindings] of Object.entries(groups)) {
        for (const side of ['img', 'omg'] as const) {
          for (const group of (bindings[side] ?? []) as Array<
            Array<[string, string, [number, number], number]>
          >) {
            for (const [related, ot, [min, max]] of group) {
              out.push(`${activity}|${side}|${related}|${ot}|${min}|${max}`);
            }
          }
        }
      }
      return new Set(out);
    };
    expect(normalise(back.markerGroups)).toEqual(normalise(original.markerGroups));
  });

  it('preserves activity positions and type colors through layout', () => {
    const original = buildOccnExample();
    const asset = occnModelToAsset(original);
    expect(asset).toHaveProperty('layout');
    const back = assetToOccnModel(asset, original.name);
    for (const activity of original.activities) {
      if (!activity.position) continue;
      const roundTripped = back.activities.find((a) => a.name === activity.name);
      expect(roundTripped?.position).toEqual(activity.position);
    }
    for (const type of original.objectTypes) {
      if (!type.color) continue;
      const roundTripped = back.objectTypes.find((t) => t.name === type.name);
      expect(roundTripped?.color).toBe(type.color);
    }
  });

  it('imports the committed canonical OCCN example', () => {
    const model = assetToOccnModel(occnCanonical, 'canonical');
    const reparsed = parseOccnModelFile(model);
    expect(reparsed.ok).toBe(true);
    // Re-exporting the imported canonical model reproduces the same activities
    // and object types.
    const reAsset = occnModelToAsset(model) as {
      activities: string[];
      object_types: string[];
    };
    expect(reAsset.activities).toEqual((occnCanonical as { activities: string[] }).activities);
    expect(reAsset.object_types).toEqual(
      (occnCanonical as { object_types: string[] }).object_types,
    );
  });
});
