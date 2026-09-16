import type { OcdfgModelFile, XY } from '@/editors/shared/model-types';
import { OCDFG_FORMAT } from '@/editors/shared/model-types';

/**
 * Converters between the OC-DFG editor model file and the canonical OC-DFG
 * JSON (`"schema": "ocdfg"`, version 1) that mirrors the backend's internal
 * directly-follows representation (`totem_lib.dfg`): activities are
 * identified by their NAME, the artificial START/END node of an object type
 * is the pseudo node `__start__:<type>` / `__end__:<type>`, and every edge
 * is a `{source, target, object_type}` triple (a multigraph per type).
 *
 * Following the model-asset convention (see PR #273 / asset-format.ts for
 * TOTeM and OCCN), the canonical model is the single source of truth and the
 * editor adds an OPTIONAL `layout` block (node positions, type colors, arc
 * bend points, and empty START/END markers) that model consumers ignore.
 * A saved editor file is therefore a strict superset of the model format,
 * and a plain model file (no layout) opens in the editor with auto layout.
 */

export const OCDFG_SCHEMA = 'ocdfg' as const;
export const OCDFG_SCHEMA_VERSION = 1 as const;

export const startNodeId = (objectType: string) => `__start__:${objectType}`;
export const endNodeId = (objectType: string) => `__end__:${objectType}`;

const START_PREFIX = '__start__:';
const END_PREFIX = '__end__:';

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

/** True when a parsed JSON object is a canonical OC-DFG model file. */
export function isOcdfgAsset(raw: unknown): boolean {
  return isRecord(raw) && raw.schema === OCDFG_SCHEMA;
}

/** Layout entry for one node: an optional canvas position. */
type LayoutNode = { position?: XY };

/**
 * Editor OC-DFG model → canonical model JSON (with optional `layout`).
 *
 * Activity names become the canonical node identity, so they must be
 * non-empty and unique — the editor enforces this on rename; this converter
 * throws a user-readable Error as the safety net (e.g. for legacy files
 * loaded with duplicate names).
 */
export function ocdfgModelToAsset(model: OcdfgModelFile): Record<string, unknown> {
  // Internal node id → canonical name.
  const canonicalId = new Map<string, string>();
  const usedNames = new Set<string>();
  for (const activity of model.activities) {
    const name = activity.label.trim();
    if (!name) {
      throw new Error(
        `Activity "${activity.id}" has no name — every activity needs a unique name to save.`,
      );
    }
    if (usedNames.has(name)) {
      throw new Error(
        `Two activities are named "${name}" — activity names identify the nodes of an OC-DFG and must be unique.`,
      );
    }
    usedNames.add(name);
    canonicalId.set(activity.id, name);
  }
  for (const control of model.starts) canonicalId.set(control.id, startNodeId(control.objectType));
  for (const control of model.ends) canonicalId.set(control.id, endNodeId(control.objectType));

  const edges = model.arcs
    .map((arc) => ({
      source: canonicalId.get(arc.source) ?? arc.source,
      target: canonicalId.get(arc.target) ?? arc.target,
      object_type: arc.objectType,
    }))
    .sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.target.localeCompare(b.target) ||
        a.object_type.localeCompare(b.object_type),
    );

  const asset: Record<string, unknown> = {
    schema: OCDFG_SCHEMA,
    version: OCDFG_SCHEMA_VERSION,
    name: model.name,
    object_types: model.objectTypes.map((t) => t.name).sort(),
    activities: [...usedNames].sort(),
    edges,
  };

  // ---- optional layout block (editor-only, ignored by model consumers) ----
  const layoutObjectTypes: Record<string, { color: string }> = {};
  for (const type of model.objectTypes) {
    if (type.color) layoutObjectTypes[type.name] = { color: type.color };
  }
  const layoutActivities: Record<string, LayoutNode> = {};
  for (const activity of model.activities) {
    if (activity.position) {
      layoutActivities[canonicalId.get(activity.id)!] = {
        position: { x: activity.position.x, y: activity.position.y },
      };
    }
  }
  // START/END entries also mark nodes that exist without any edge yet.
  const controlLayout = (controls: OcdfgModelFile['starts']) => {
    const entries: Record<string, LayoutNode> = {};
    for (const control of controls) {
      entries[control.objectType] = control.position
        ? { position: { x: control.position.x, y: control.position.y } }
        : {};
    }
    return entries;
  };
  const layoutEdges = model.arcs
    .filter((arc) => arc.waypoints && arc.waypoints.length > 0)
    .map((arc) => ({
      source: canonicalId.get(arc.source) ?? arc.source,
      target: canonicalId.get(arc.target) ?? arc.target,
      object_type: arc.objectType,
      waypoints: arc.waypoints!.map((p) => ({ x: p.x, y: p.y })),
    }));

  asset.layout = {
    objectTypes: layoutObjectTypes,
    activities: layoutActivities,
    starts: controlLayout(model.starts),
    ends: controlLayout(model.ends),
    ...(layoutEdges.length > 0 ? { edges: layoutEdges } : {}),
  };

  return asset;
}

/**
 * Canonical OC-DFG model JSON → editor model file. Structural validation
 * beyond the basic shape happens in `parseOcdfgModelFile`, which callers run
 * on the result — exactly like the OCCN/TOTeM asset converters.
 */
export function assetToOcdfgModel(raw: unknown, fallbackName: string): OcdfgModelFile {
  if (!isRecord(raw)) throw new Error('OC-DFG model file must be a JSON object.');
  if (!Array.isArray(raw.activities)) {
    throw new Error('OC-DFG model file needs an "activities" list.');
  }
  const edgesRaw = raw.edges ?? [];
  if (!Array.isArray(edgesRaw)) throw new Error('"edges" must be an array.');

  const layout = isRecord(raw.layout) ? raw.layout : {};
  const layoutObjectTypes = isRecord(layout.objectTypes) ? layout.objectTypes : {};
  const layoutActivities = isRecord(layout.activities) ? layout.activities : {};
  const layoutStarts = isRecord(layout.starts) ? layout.starts : {};
  const layoutEnds = isRecord(layout.ends) ? layout.ends : {};
  const layoutEdges = Array.isArray(layout.edges) ? layout.edges : [];

  const nodePosition = (entries: Record<string, unknown>, key: string): XY | undefined => {
    const entry = entries[key];
    return isRecord(entry) && isXY(entry.position) ? entry.position : undefined;
  };

  const typeNames: string[] = Array.isArray(raw.object_types)
    ? raw.object_types.filter((t): t is string => typeof t === 'string')
    : [];

  const activities = raw.activities
    .map((entry) => asName(entry))
    .filter((name): name is string => name !== null)
    .map((name) => ({
      id: name,
      label: name,
      position: nodePosition(layoutActivities, name),
    }));

  // START/END nodes exist when an edge references them or the layout lists
  // them (a node the user placed but has not connected yet).
  const startTypes = new Set<string>(Object.keys(layoutStarts));
  const endTypes = new Set<string>(Object.keys(layoutEnds));
  for (const entry of edgesRaw) {
    if (!isRecord(entry)) continue;
    // Register pseudo nodes from EITHER endpoint — even an ill-directed edge
    // (into a START / out of an END) must resolve to the node so the shared
    // validator can reject it with its precise message.
    for (const endpoint of [entry.source, entry.target]) {
      if (typeof endpoint !== 'string') continue;
      if (endpoint.startsWith(START_PREFIX)) startTypes.add(endpoint.slice(START_PREFIX.length));
      if (endpoint.startsWith(END_PREFIX)) endTypes.add(endpoint.slice(END_PREFIX.length));
    }
  }

  const starts = [...startTypes].sort().map((objectType) => ({
    id: startNodeId(objectType),
    objectType,
    position: nodePosition(layoutStarts, objectType),
  }));
  const ends = [...endTypes].sort().map((objectType) => ({
    id: endNodeId(objectType),
    objectType,
    position: nodePosition(layoutEnds, objectType),
  }));

  const waypointsFor = (source: string, target: string, objectType: string): XY[] | undefined => {
    for (const entry of layoutEdges) {
      if (
        isRecord(entry) &&
        entry.source === source &&
        entry.target === target &&
        entry.object_type === objectType &&
        Array.isArray(entry.waypoints)
      ) {
        const points = entry.waypoints.filter(isXY).map((p) => ({ x: p.x, y: p.y }));
        return points.length > 0 ? points : undefined;
      }
    }
    return undefined;
  };

  const arcs = edgesRaw.map((entry, index) => {
    const source = isRecord(entry) && typeof entry.source === 'string' ? entry.source : '';
    const target = isRecord(entry) && typeof entry.target === 'string' ? entry.target : '';
    const objectType =
      isRecord(entry) && typeof entry.object_type === 'string' ? entry.object_type : '';
    return {
      id: `arc-${index + 1}`,
      source,
      target,
      objectType,
      waypoints: waypointsFor(source, target, objectType),
    };
  });

  return {
    format: OCDFG_FORMAT,
    version: 1,
    name: asName(raw.name) ?? fallbackName,
    objectTypes: typeNames.map((name) => {
      const entry = layoutObjectTypes[name];
      return {
        name,
        color: isRecord(entry) && typeof entry.color === 'string' ? entry.color : undefined,
      };
    }),
    activities,
    starts,
    ends,
    arcs,
  };
}
