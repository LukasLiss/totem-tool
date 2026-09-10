/**
 * Converters between the visual-editor model files and the canonical model
 * asset-store JSON (`"schema": "totem" | "occn"`, version 1) defined by
 * `totem_lib` (`totem/serialization.py`, `occn/serialization.py`).
 *
 * The asset-store format is the single stored representation. It carries the
 * exact model structure the miner produces; the editor adds an OPTIONAL
 * `layout` block (node positions, colors, extra arcs) that the backend
 * validates when present but the Python model ignores. This keeps editor files
 * a strict superset of the miner format: a saved editor file uploads with no
 * conversion, and a downloaded asset re-opens in the editor with its layout.
 *
 * Edge labels / cardinalities stay in the miner's spelling (triple-dot
 * `0...1` / `0...*`); the editor's parser (`normaliseCardinality`) already
 * collapses those back to `0..1` / `0..*` on import.
 */

import {
  OCCN_FORMAT,
  TOTEM_FORMAT,
  type EventCardinality,
  type LogCardinality,
  type OccnActivityBindings,
  type OccnMarker,
  type OccnMarkerGroup,
  type OccnModelFile,
  type TemporalRelation,
  type TotemModelFile,
  type TotemRelation,
  type XY,
} from '@/editors/shared/model-types';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const TOTEM_SCHEMA = 'totem' as const;
export const OCCN_SCHEMA = 'occn' as const;
export const SCHEMA_VERSION = 1 as const;

/** Layout entry for one node: optional position and color. */
export type LayoutNode = { position?: XY; color?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isXY = (value: unknown): value is XY =>
  isRecord(value) &&
  typeof value.x === 'number' &&
  Number.isFinite(value.x) &&
  typeof value.y === 'number' &&
  Number.isFinite(value.y);

const asName = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

/** The miner keeps triple-dot spellings; the editor UI uses double-dot. */
const toAssetCardinality = (value: string): string =>
  value.replace('0..1', '0...1').replace('0..*', '0...*');

/** True when a parsed JSON object looks like an asset-store model of `schema`. */
export function isAssetModel(raw: unknown, schema: string): boolean {
  return isRecord(raw) && raw.schema === schema;
}

// ---------------------------------------------------------------------------
// TOTeM
// ---------------------------------------------------------------------------

const TOTEM_RELATION_KEYS: TemporalRelation[] = ['D', 'Di', 'I', 'Ii', 'P'];

/**
 * The miner records a temporal relation per direction, always as a consistent
 * inverse pair: P<->P, D<->Di, I<->Ii. The editor keeps one relation per
 * unordered pair, read source -> target; `inverseRelation` gives the code for
 * the reverse direction so export can expand it back to both directed edges.
 */
const inverseRelation = (temporal: TemporalRelation): TemporalRelation => {
  switch (temporal) {
    case 'D':
      return 'Di';
    case 'Di':
      return 'D';
    case 'I':
      return 'Ii';
    case 'Ii':
      return 'I';
    case 'P':
      return 'P';
  }
};

/**
 * Generality order for reconciling an inconsistent imported file (one direction
 * says P, the other D/I): pick the most general. P > I/Ii > D/Di.
 */
const relationGenerality: Record<TemporalRelation, number> = {
  P: 3,
  I: 2,
  Ii: 2,
  D: 1,
  Di: 1,
};

/** Editor TOTeM model -> canonical asset JSON (with optional `layout`). */
export function totemModelToAsset(model: TotemModelFile): Record<string, unknown> {
  const nodes = model.objectTypes.map((t) => t.name).sort();

  const tempgraph: Record<string, unknown> = { nodes };
  for (const key of TOTEM_RELATION_KEYS) tempgraph[key] = [];

  const cardinalities: Array<Record<string, string>> = [];
  const typeRelations: string[][] = [];

  for (const relation of model.relations) {
    // Expand the single editor relation to both directed edges the miner uses.
    (tempgraph[relation.temporal] as string[][]).push([relation.source, relation.target]);
    (tempgraph[inverseRelation(relation.temporal)] as string[][]).push([
      relation.target,
      relation.source,
    ]);
    cardinalities.push({
      from: relation.source,
      to: relation.target,
      log_cardinality: toAssetCardinality(relation.sourceToTarget.log),
      event_cardinality: toAssetCardinality(relation.sourceToTarget.event),
    });
    cardinalities.push({
      from: relation.target,
      to: relation.source,
      log_cardinality: toAssetCardinality(relation.targetToSource.log),
      event_cardinality: toAssetCardinality(relation.targetToSource.event),
    });
    typeRelations.push([relation.source, relation.target].sort());
  }

  for (const key of TOTEM_RELATION_KEYS) {
    (tempgraph[key] as string[][]).sort(compareEdge);
  }
  cardinalities.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  typeRelations.sort(compareEdge);

  const asset: Record<string, unknown> = {
    schema: TOTEM_SCHEMA,
    version: SCHEMA_VERSION,
    tempgraph,
    cardinalities,
    type_relations: typeRelations,
    // A hand-authored TOTeM model has no event log: emit empty (but present)
    // event-type maps so the canonical validator accepts the file.
    all_event_types: [],
    object_type_to_event_types: {},
  };

  const layout = totemLayout(model);
  if (layout) asset.layout = layout;
  return asset;
}

function totemLayout(model: TotemModelFile): Record<string, unknown> | null {
  const objectTypes: Record<string, LayoutNode> = {};
  let hasLayout = false;
  for (const type of model.objectTypes) {
    const entry: LayoutNode = {};
    if (type.position) entry.position = { x: type.position.x, y: type.position.y };
    if (type.color) entry.color = type.color;
    if (entry.position || entry.color) {
      objectTypes[type.name] = entry;
      hasLayout = true;
    }
  }
  return hasLayout ? { objectTypes } : null;
}

/**
 * Canonical TOTeM asset JSON -> editor model file.
 *
 * The miner stores a temporal relation per direction; the editor keeps one per
 * unordered pair. For a well-formed miner file the two directions are a
 * consistent inverse pair (P<->P, D<->Di, I<->Ii) and collapse losslessly. When
 * they disagree the more general relation is kept (P > I/Ii > D/Di) and a
 * warning is returned.
 */
export function assetToTotemModel(
  raw: unknown,
  name: string,
): { model: TotemModelFile; warnings: string[] } {
  if (!isRecord(raw)) throw new Error('TOTeM asset must be a JSON object.');
  const tempgraph = isRecord(raw.tempgraph) ? raw.tempgraph : {};

  const layout = isRecord(raw.layout) ? raw.layout : {};
  const layoutTypes = isRecord(layout.objectTypes) ? layout.objectTypes : {};

  const nodeNames = Array.isArray(tempgraph.nodes)
    ? tempgraph.nodes.filter((n): n is string => typeof n === 'string')
    : [];
  const objectTypes = nodeNames.map((nodeName) => {
    const entry = isRecord(layoutTypes[nodeName]) ? layoutTypes[nodeName] : {};
    return {
      name: nodeName,
      color: typeof entry.color === 'string' ? entry.color : undefined,
      position: isXY(entry.position) ? entry.position : undefined,
    };
  });

  const cardByPair = new Map<string, { log: string; event: string }>();
  if (Array.isArray(raw.cardinalities)) {
    for (const entry of raw.cardinalities) {
      if (!isRecord(entry)) continue;
      const from = asName(entry.from);
      const to = asName(entry.to);
      if (!from || !to) continue;
      cardByPair.set(`${from} ${to}`, {
        log: typeof entry.log_cardinality === 'string' ? entry.log_cardinality : '1',
        event: typeof entry.event_cardinality === 'string' ? entry.event_cardinality : '1',
      });
    }
  }

  // Collect the directed temporal relation for each ordered (source, target).
  const directed = new Map<string, TemporalRelation>();
  const order: string[] = [];
  for (const temporal of TOTEM_RELATION_KEYS) {
    const edges = Array.isArray(tempgraph[temporal]) ? (tempgraph[temporal] as unknown[]) : [];
    for (const edge of edges) {
      if (!Array.isArray(edge) || edge.length !== 2) continue;
      const source = asName(edge[0]);
      const target = asName(edge[1]);
      if (!source || !target) continue;
      const key = `${source} ${target}`;
      if (!directed.has(key)) order.push(key);
      directed.set(key, temporal);
    }
  }

  // Collapse to one editor relation per unordered pair.
  const relations: TotemRelation[] = [];
  const warnings: string[] = [];
  const handledPairs = new Set<string>();
  let relationIndex = 0;

  for (const orderedKey of order) {
    const [source, target] = orderedKey.split(' ');
    const pairKey = [source, target].slice().sort().join(' ');
    if (handledPairs.has(pairKey)) continue;
    handledPairs.add(pairKey);

    const forwardRel = directed.get(orderedKey) as TemporalRelation;
    const reverseRel = directed.get(`${target} ${source}`);
    let temporal: TemporalRelation = forwardRel;

    // A well-formed file has the exact inverse the other way. If not, keep the
    // more general relation (oriented source -> target) and warn.
    if (reverseRel && reverseRel !== inverseRelation(forwardRel)) {
      const reverseAsForward = inverseRelation(reverseRel);
      temporal =
        relationGenerality[reverseAsForward] > relationGenerality[forwardRel]
          ? reverseAsForward
          : forwardRel;
      warnings.push(
        `Relation between "${source}" and "${target}" had mismatched directions ` +
          `(${forwardRel} / ${reverseRel}); kept the more general "${temporal}".`,
      );
    }

    const forwardCard = cardByPair.get(`${source} ${target}`);
    const backwardCard = cardByPair.get(`${target} ${source}`);
    relations.push({
      id: `relation-${(relationIndex += 1)}`,
      source,
      target,
      temporal,
      sourceToTarget: {
        log: (forwardCard ? forwardCard.log : '1') as LogCardinality,
        event: (forwardCard ? forwardCard.event : '1') as EventCardinality,
      },
      targetToSource: {
        log: (backwardCard ? backwardCard.log : '1') as LogCardinality,
        event: (backwardCard ? backwardCard.event : '1') as EventCardinality,
      },
    });
  }

  return {
    model: {
      format: TOTEM_FORMAT,
      version: 1,
      name,
      objectTypes,
      relations,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// OCCN
// ---------------------------------------------------------------------------

type ResolvedMarker = {
  related_activity: string;
  object_type: string;
  min_count: number;
  max_count: number | null;
  marker_key: number;
};

type ResolvedGroup = { support_count: number | null; markers: ResolvedMarker[] };

/**
 * Editor OCCN model -> canonical asset JSON. Resolves the `markerGroups`
 * (`from_dict` shape) into the miner's `input_marker_groups` /
 * `output_marker_groups`, derives the dependency graph, and defaults the
 * log-derived fields (`activity_count`, `relative_occurrence_threshold`) the
 * editor has no data for -- exactly what `OCCausalNet.from_dict` does.
 */
export function occnModelToAsset(model: OccnModelFile): Record<string, unknown> {
  const activities = model.activities.map((a) => a.name);
  const activitySet = new Set(activities);

  // Marker groups auto-assign keys (0 -> unique) exactly like the Python factory.
  const bindings = assignMarkerKeys(model.markerGroups);

  const objectTypeSet = new Set<string>(model.objectTypes.map((t) => t.name));
  for (const activity of Object.keys(bindings)) {
    for (const side of ['img', 'omg'] as const) {
      for (const group of bindings[activity]?.[side] ?? []) {
        for (const [, objectType] of group) objectTypeSet.add(objectType);
      }
    }
  }
  const objectTypes = [...objectTypeSet].sort();

  const inputMarkerGroups: Record<string, ResolvedGroup[]> = {};
  const outputMarkerGroups: Record<string, ResolvedGroup[]> = {};
  for (const activity of activities) {
    inputMarkerGroups[activity] = resolveGroups(bindings[activity]?.img);
    outputMarkerGroups[activity] = resolveGroups(bindings[activity]?.omg);
  }

  // Dependency edges: from omg (A -> related) and img (related -> A), deduped.
  const edgeSet = new Set<string>();
  const edges: Array<{ source: string; target: string; object_type: string }> = [];
  const addEdge = (source: string, target: string, objectType: string) => {
    const key = `${source} ${target} ${objectType}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ source, target, object_type: objectType });
  };
  for (const activity of activities) {
    for (const group of bindings[activity]?.omg ?? []) {
      for (const [related, objectType] of group) addEdge(activity, related, objectType);
    }
    for (const group of bindings[activity]?.img ?? []) {
      for (const [related, objectType] of group) addEdge(related, activity, objectType);
    }
  }
  edges.sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      a.object_type.localeCompare(b.object_type),
  );

  const activityCount: Record<string, number> = {};
  for (const activity of activities.slice().sort()) activityCount[activity] = 1;

  const asset: Record<string, unknown> = {
    schema: OCCN_SCHEMA,
    version: SCHEMA_VERSION,
    activities: activities.slice().sort(),
    object_types: objectTypes,
    dependency_graph: { edges },
    input_marker_groups: sortKeys(inputMarkerGroups),
    output_marker_groups: sortKeys(outputMarkerGroups),
    activity_count: activityCount,
    relative_occurrence_threshold: 0,
  };

  const layout = occnLayout(model, activitySet, objectTypeSet, edgeSet);
  if (layout) asset.layout = layout;
  return asset;
}

function resolveGroups(groups: OccnMarkerGroup[] | undefined): ResolvedGroup[] {
  return (groups ?? [])
    .filter((group) => group.length > 0)
    .map((group) => ({
      support_count: null,
      markers: group.map(
        ([related, objectType, [min, max], key]): ResolvedMarker => ({
          related_activity: related,
          object_type: objectType,
          min_count: min,
          max_count: max === -1 ? null : max,
          marker_key: key,
        }),
      ),
    }));
}

/**
 * Assign a unique positive key to every marker whose key is 0, mirroring
 * `occn/factory.py`: keys are unique across the whole net so shared keys mean
 * "bind the same objects".
 */
function assignMarkerKeys(
  markerGroups: Record<string, OccnActivityBindings>,
): Record<string, OccnActivityBindings> {
  let maxKey = 0;
  for (const bindings of Object.values(markerGroups)) {
    for (const side of ['img', 'omg'] as const) {
      for (const group of bindings[side] ?? []) {
        for (const [, , , key] of group) maxKey = Math.max(maxKey, key);
      }
    }
  }
  let next = maxKey + 1;

  const cloneGroup = (group: OccnMarkerGroup): OccnMarkerGroup =>
    group.map(([related, ot, [min, max], key]): OccnMarker => [
      related,
      ot,
      [min, max],
      key === 0 ? next++ : key,
    ]);

  const result: Record<string, OccnActivityBindings> = Object.create(null);
  for (const [activity, bindings] of Object.entries(markerGroups)) {
    result[activity] = {
      img: (bindings.img ?? []).map(cloneGroup),
      omg: (bindings.omg ?? []).map(cloneGroup),
    };
  }
  return result;
}

function occnLayout(
  model: OccnModelFile,
  activitySet: Set<string>,
  objectTypeSet: Set<string>,
  edgeSet: Set<string>,
): Record<string, unknown> | null {
  const activities: Record<string, LayoutNode> = {};
  for (const activity of model.activities) {
    if (activity.position && activitySet.has(activity.name)) {
      activities[activity.name] = {
        position: { x: activity.position.x, y: activity.position.y },
      };
    }
  }

  const objectTypes: Record<string, LayoutNode> = {};
  for (const type of model.objectTypes) {
    if (type.color && objectTypeSet.has(type.name)) {
      objectTypes[type.name] = { color: type.color };
    }
  }

  // Only arcs the marker groups did NOT already imply need explicit storage.
  const extraArcs: Array<{ source: string; target: string; object_type: string }> = [];
  for (const arc of model.arcs) {
    const key = `${arc.source} ${arc.target} ${arc.objectType}`;
    if (edgeSet.has(key)) continue;
    if (!activitySet.has(arc.source) || !activitySet.has(arc.target)) continue;
    if (!objectTypeSet.has(arc.objectType)) continue;
    extraArcs.push({ source: arc.source, target: arc.target, object_type: arc.objectType });
  }

  const layout: Record<string, unknown> = {};
  if (Object.keys(activities).length > 0) layout.activities = activities;
  if (Object.keys(objectTypes).length > 0) layout.objectTypes = objectTypes;
  if (extraArcs.length > 0) layout.arcs = extraArcs;
  return Object.keys(layout).length > 0 ? layout : null;
}

/** Canonical OCCN asset JSON -> editor model file (`markerGroups` shape). */
export function assetToOccnModel(raw: unknown, name: string): OccnModelFile {
  if (!isRecord(raw)) throw new Error('OCCN asset must be a JSON object.');

  const activityNames = Array.isArray(raw.activities)
    ? raw.activities.filter((a): a is string => typeof a === 'string')
    : [];

  const layout = isRecord(raw.layout) ? raw.layout : {};
  const layoutActivities = isRecord(layout.activities) ? layout.activities : {};
  const layoutTypes = isRecord(layout.objectTypes) ? layout.objectTypes : {};

  const activities = activityNames.map((activityName) => {
    const entry = isRecord(layoutActivities[activityName])
      ? layoutActivities[activityName]
      : {};
    return {
      name: activityName,
      position: isXY(entry.position) ? entry.position : undefined,
    };
  });

  const objectTypes = (
    Array.isArray(raw.object_types)
      ? raw.object_types.filter((t): t is string => typeof t === 'string')
      : []
  ).map((typeName) => {
    const entry = isRecord(layoutTypes[typeName]) ? layoutTypes[typeName] : {};
    return { name: typeName, color: typeof entry.color === 'string' ? entry.color : undefined };
  });

  // Rebuild the from_dict `markerGroups` from the resolved input/output groups.
  const markerGroups: Record<string, OccnActivityBindings> = Object.create(null);
  const toEditorGroups = (groups: unknown): OccnMarkerGroup[] => {
    if (!Array.isArray(groups)) return [];
    const result: OccnMarkerGroup[] = [];
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.markers)) continue;
      const markers: OccnMarker[] = [];
      for (const marker of group.markers) {
        if (!isRecord(marker)) continue;
        const related = asName(marker.related_activity);
        const objectType = asName(marker.object_type);
        const min = typeof marker.min_count === 'number' ? marker.min_count : 0;
        const max =
          marker.max_count === null || marker.max_count === undefined
            ? -1
            : (marker.max_count as number);
        const key = typeof marker.marker_key === 'number' ? marker.marker_key : 0;
        if (!related || !objectType) continue;
        markers.push([related, objectType, [min, max], key]);
      }
      if (markers.length > 0) result.push(markers);
    }
    return result;
  };

  const inputGroups = isRecord(raw.input_marker_groups) ? raw.input_marker_groups : {};
  const outputGroups = isRecord(raw.output_marker_groups) ? raw.output_marker_groups : {};
  for (const activityName of activityNames) {
    markerGroups[activityName] = {
      img: toEditorGroups(inputGroups[activityName]),
      omg: toEditorGroups(outputGroups[activityName]),
    };
  }

  // Arcs: dependency graph edges plus any editor-only arcs kept in layout.
  const arcs: OccnModelFile['arcs'] = [];
  const arcKeys = new Set<string>();
  const addArc = (source: string, target: string, objectType: string) => {
    const key = `${source} ${target} ${objectType}`;
    if (arcKeys.has(key)) return;
    arcKeys.add(key);
    arcs.push({ source, target, objectType });
  };
  const depEdges = isRecord(raw.dependency_graph) && Array.isArray(raw.dependency_graph.edges)
    ? raw.dependency_graph.edges
    : [];
  for (const edge of depEdges) {
    if (!isRecord(edge)) continue;
    const source = asName(edge.source);
    const target = asName(edge.target);
    const objectType = asName(edge.object_type);
    if (source && target && objectType) addArc(source, target, objectType);
  }
  if (Array.isArray(layout.arcs)) {
    for (const arc of layout.arcs) {
      if (!isRecord(arc)) continue;
      const source = asName(arc.source);
      const target = asName(arc.target);
      const objectType = asName(arc.object_type);
      if (source && target && objectType) addArc(source, target, objectType);
    }
  }

  return {
    format: OCCN_FORMAT,
    version: 1,
    name,
    objectTypes,
    activities,
    arcs,
    markerGroups,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function compareEdge(a: string[], b: string[]): number {
  return (a[0] ?? '').localeCompare(b[0] ?? '') || (a[1] ?? '').localeCompare(b[1] ?? '');
}

function sortKeys<T>(value: Record<string, T>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const key of Object.keys(value).sort()) result[key] = value[key];
  return result;
}
