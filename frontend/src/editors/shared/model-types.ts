/**
 * JSON file formats for the three model editors.
 *
 * The formats follow the formal definitions of the models and stay close to
 * the representations used in `totem_lib`:
 *  - TOTeM:  Liss et al., "TOTeM: Temporal Object Type Model for
 *            Object-Centric Process Mining" (BPM 2024). Temporal relation
 *            codes match totem_lib/totem (D, Di, I, Ii, P).
 *  - OCCN:   Liss et al., "Object-Centric Causal Nets" (CAiSE 2025).
 *            `markerGroups` matches the dict accepted by
 *            `totem_lib.OCCausalNet.from_dict` (marker tuples
 *            [relatedActivity, objectType, [min, max], key], max -1 = ∞).
 *  - OCPN:   van der Aalst & Berti, "Discovering Object-Centric Petri Nets".
 *            ON = (N, pt, F_var) plus initial/final flags for source/sink
 *            places.
 *
 * Node positions are stored so a saved model re-opens with the same layout;
 * they are optional on import (a simple auto layout is applied when missing).
 */

export type XY = { x: number; y: number };

export type ObjectTypeDef = {
  name: string;
  color?: string;
};

export type ParseResult<T> =
  | { ok: true; model: T; warnings?: string[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// TOTeM
// ---------------------------------------------------------------------------

export const TOTEM_FORMAT = 'totem-model' as const;

/**
 * Temporal relation of a TOTeM edge, read in source → target direction.
 * D = during (paper: filled square at the marked end), Di = during-inverse,
 * I = initiating/precedes (paper: filled arrowhead), Ii = precedes-inverse,
 * P = parallel (paper: double bars at both ends).
 */
export type TemporalRelation = 'D' | 'Di' | 'I' | 'Ii' | 'P';

export type LogCardinality = '1' | '0..1' | '1..*' | '0..*';
export type EventCardinality = '0' | '1' | '0..1' | '1..*' | '0..*';

export const TEMPORAL_RELATIONS: TemporalRelation[] = ['D', 'Di', 'I', 'Ii', 'P'];
export const LOG_CARDINALITIES: LogCardinality[] = ['1', '0..1', '1..*', '0..*'];
export const EVENT_CARDINALITIES: EventCardinality[] = ['0', '1', '0..1', '1..*', '0..*'];

export const TEMPORAL_RELATION_LABELS: Record<TemporalRelation, string> = {
  D: 'During (■ at target)',
  Di: 'During inverse (■ at source)',
  I: 'Precedes (▶ at target)',
  Ii: 'Precedes inverse (▶ at source)',
  P: 'Parallel (∥ both ends)',
};

export type TotemDirectionAnnotation = {
  /** Log cardinality: objects of the direction's target type per object of its source type. */
  log: LogCardinality;
  /** Event cardinality: objects of the direction's target type per event involving the source type. */
  event: EventCardinality;
};

export type TotemObjectType = {
  name: string;
  color?: string;
  position?: XY;
};

export type TotemRelation = {
  id: string;
  /** Object type name the edge starts at. */
  source: string;
  /** Object type name the edge ends at. */
  target: string;
  /** Temporal relation, read source → target. */
  temporal: TemporalRelation;
  sourceToTarget: TotemDirectionAnnotation;
  targetToSource: TotemDirectionAnnotation;
};

export type TotemModelFile = {
  format: typeof TOTEM_FORMAT;
  version: 1;
  name: string;
  objectTypes: TotemObjectType[];
  relations: TotemRelation[];
};

// ---------------------------------------------------------------------------
// OCCN — object-centric causal nets
// ---------------------------------------------------------------------------

export const OCCN_FORMAT = 'occn' as const;

/**
 * One marker: an obligation towards / from `relatedActivity` for objects of
 * `objectType` with a cardinality range. `max` of -1 means unbounded (∞),
 * mirroring totem_lib. `key` groups markers that must bind the same objects
 * (0 = no constraint / auto-key).
 */
export type OccnMarker = [
  relatedActivity: string,
  objectType: string,
  countRange: [number, number],
  markerKey: number,
];

/** A marker group is an AND-combination of markers; groups are OR-alternatives. */
export type OccnMarkerGroup = OccnMarker[];

export type OccnActivityBindings = {
  /** Input marker groups (consumed obligations). */
  img?: OccnMarkerGroup[];
  /** Output marker groups (created obligations). */
  omg?: OccnMarkerGroup[];
};

export type OccnActivity = {
  name: string;
  position?: XY;
};

/** Dependency arc annotated with an object type (multigraph per type). */
export type OccnArc = {
  source: string;
  target: string;
  objectType: string;
};

export type OccnModelFile = {
  format: typeof OCCN_FORMAT;
  version: 1;
  name: string;
  objectTypes: ObjectTypeDef[];
  /** All activities incl. START_<type> / END_<type> pseudo activities. */
  activities: OccnActivity[];
  /**
   * Dependency graph arcs. Kept explicit so arcs without marker groups
   * survive a save/load round trip; consumers deriving arcs from omg (like
   * OCCausalNet.from_dict) may ignore this field.
   */
  arcs: OccnArc[];
  /** Bindings per activity, format of totem_lib OCCausalNet.from_dict. */
  markerGroups: Record<string, OccnActivityBindings>;
};

export const occnStartActivity = (objectType: string) => `START_${objectType}`;
export const occnEndActivity = (objectType: string) => `END_${objectType}`;

// ---------------------------------------------------------------------------
// OCPN — object-centric Petri nets
// ---------------------------------------------------------------------------

export const OCPN_FORMAT = 'ocpn' as const;

export type OcpnPlace = {
  id: string;
  /** Object type of the place (pt is a total function). */
  objectType: string;
  /** Part of the initial marking (source place). */
  initial?: boolean;
  /** Part of the final marking (sink place). */
  final?: boolean;
  position?: XY;
};

export type OcpnTransition = {
  id: string;
  /** Activity label; null/absent = silent (τ) transition. */
  label?: string | null;
  silent?: boolean;
  position?: XY;
};

export type OcpnArc = {
  id: string;
  /** Place id or transition id (bipartite: exactly one endpoint of each kind). */
  source: string;
  target: string;
  /** Variable arc (∈ F_var): consumes/produces a set of objects, drawn as double line. */
  variable?: boolean;
  /**
   * Optional bend points the drawn arc is routed through, in canvas
   * coordinates. Pure layout hint (like node positions) — consumers that only
   * read the net can safely ignore it.
   */
  waypoints?: XY[];
};

export type OcpnModelFile = {
  format: typeof OCPN_FORMAT;
  version: 1;
  name: string;
  objectTypes: ObjectTypeDef[];
  places: OcpnPlace[];
  transitions: OcpnTransition[];
  arcs: OcpnArc[];
};

// ---------------------------------------------------------------------------
// Parsing / validation helpers
// ---------------------------------------------------------------------------

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

/**
 * Best-effort detection of which editor a JSON file belongs to, used to give
 * a helpful error when a model is loaded in the wrong editor.
 */
export function detectModelFormat(
  raw: unknown,
): typeof TOTEM_FORMAT | typeof OCCN_FORMAT | typeof OCPN_FORMAT | null {
  if (!isRecord(raw)) return null;
  if (raw.format === TOTEM_FORMAT || raw.format === OCCN_FORMAT || raw.format === OCPN_FORMAT) {
    return raw.format;
  }
  if (Array.isArray(raw.relations) && Array.isArray(raw.objectTypes)) return TOTEM_FORMAT;
  if (isRecord(raw.markerGroups)) return OCCN_FORMAT;
  if (Array.isArray(raw.places) && Array.isArray(raw.transitions)) return OCPN_FORMAT;
  return null;
}

export function wrongFormatMessage(expected: string, raw: unknown): string {
  const detected = detectModelFormat(raw);
  const editorName: Record<string, string> = {
    [TOTEM_FORMAT]: 'TOTeM Model editor',
    [OCCN_FORMAT]: 'OC Causal Net editor',
    [OCPN_FORMAT]: 'OC Petri Net editor',
  };
  if (detected && detected !== expected) {
    return `This file contains a "${detected}" model — open it in the ${editorName[detected]} instead.`;
  }
  return `The file is not a valid "${expected}" model file.`;
}

/** Normalise cardinality spellings used elsewhere (e.g. totem_lib "0...1", "0...*"). */
function normaliseCardinality(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().replace(/\.{2,}/g, '..');
}

function parseLogCardinality(value: unknown): LogCardinality | null {
  const normalised = normaliseCardinality(value);
  return LOG_CARDINALITIES.includes(normalised as LogCardinality)
    ? (normalised as LogCardinality)
    : null;
}

function parseEventCardinality(value: unknown): EventCardinality | null {
  const normalised = normaliseCardinality(value);
  return EVENT_CARDINALITIES.includes(normalised as EventCardinality)
    ? (normalised as EventCardinality)
    : null;
}

function parseObjectTypeDefs(value: unknown): ObjectTypeDef[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const result: ObjectTypeDef[] = [];
  for (const entry of value) {
    const name = isRecord(entry) ? asName(entry.name) : asName(entry);
    if (!name || seen.has(name)) return null;
    seen.add(name);
    const color =
      isRecord(entry) && typeof entry.color === 'string' ? entry.color : undefined;
    result.push({ name, color });
  }
  return result;
}

export function parseTotemModelFile(raw: unknown): ParseResult<TotemModelFile> {
  if (!isRecord(raw)) return { ok: false, error: 'Model file must be a JSON object.' };

  const objectTypesRaw = raw.objectTypes;
  if (!Array.isArray(objectTypesRaw)) {
    return { ok: false, error: wrongFormatMessage(TOTEM_FORMAT, raw) };
  }
  const objectTypes: TotemObjectType[] = [];
  const typeNames = new Set<string>();
  for (const entry of objectTypesRaw) {
    const name = isRecord(entry) ? asName(entry.name) : asName(entry);
    if (!name) return { ok: false, error: 'Every object type needs a non-empty "name".' };
    if (typeNames.has(name)) {
      return { ok: false, error: `Duplicate object type "${name}".` };
    }
    typeNames.add(name);
    objectTypes.push({
      name,
      color: isRecord(entry) && typeof entry.color === 'string' ? entry.color : undefined,
      position: isRecord(entry) && isXY(entry.position) ? entry.position : undefined,
    });
  }

  const relationsRaw = raw.relations ?? [];
  if (!Array.isArray(relationsRaw)) {
    return { ok: false, error: '"relations" must be an array.' };
  }
  const relations: TotemRelation[] = [];
  const seenPairs = new Set<string>();
  const seenRelationIds = new Set<string>();
  for (const [index, entry] of relationsRaw.entries()) {
    if (!isRecord(entry)) return { ok: false, error: `Relation #${index + 1} must be an object.` };
    const source = asName(entry.source);
    const target = asName(entry.target);
    if (!source || !target) {
      return { ok: false, error: `Relation #${index + 1} needs "source" and "target".` };
    }
    if (!typeNames.has(source) || !typeNames.has(target)) {
      return {
        ok: false,
        error: `Relation #${index + 1} references unknown object type "${!typeNames.has(source) ? source : target}".`,
      };
    }
    if (source === target) {
      return { ok: false, error: `Relation #${index + 1}: self-relations are not supported in TOTeM.` };
    }
    const pairKey = JSON.stringify([source, target].sort());
    if (seenPairs.has(pairKey)) {
      return {
        ok: false,
        error: `Duplicate relation between "${source}" and "${target}" — TOTeM allows one relation per pair of types.`,
      };
    }
    seenPairs.add(pairKey);

    const temporal = typeof entry.temporal === 'string' ? (entry.temporal as TemporalRelation) : null;
    if (!temporal || !TEMPORAL_RELATIONS.includes(temporal)) {
      return {
        ok: false,
        error: `Relation #${index + 1}: "temporal" must be one of ${TEMPORAL_RELATIONS.join(', ')}.`,
      };
    }

    const parseDirection = (
      dir: unknown,
      label: string,
    ): TotemDirectionAnnotation | string => {
      if (!isRecord(dir)) return `Relation #${index + 1} is missing "${label}".`;
      const log = parseLogCardinality(dir.log);
      if (!log) {
        return `Relation #${index + 1} ${label}: "log" must be one of ${LOG_CARDINALITIES.join(', ')}.`;
      }
      const event = parseEventCardinality(dir.event);
      if (!event) {
        return `Relation #${index + 1} ${label}: "event" must be one of ${EVENT_CARDINALITIES.join(', ')}.`;
      }
      return { log, event };
    };

    const sourceToTarget = parseDirection(entry.sourceToTarget, 'sourceToTarget');
    if (typeof sourceToTarget === 'string') return { ok: false, error: sourceToTarget };
    const targetToSource = parseDirection(entry.targetToSource, 'targetToSource');
    if (typeof targetToSource === 'string') return { ok: false, error: targetToSource };

    let relationId = typeof entry.id === 'string' && entry.id ? entry.id : `relation-${index + 1}`;
    while (seenRelationIds.has(relationId)) relationId = `${relationId}-dup`;
    seenRelationIds.add(relationId);
    relations.push({
      id: relationId,
      source,
      target,
      temporal,
      sourceToTarget,
      targetToSource,
    });
  }

  return {
    ok: true,
    model: {
      format: TOTEM_FORMAT,
      version: 1,
      name: asName(raw.name) ?? 'TOTeM model',
      objectTypes,
      relations,
    },
  };
}

export function parseOcpnModelFile(raw: unknown): ParseResult<OcpnModelFile> {
  if (!isRecord(raw)) return { ok: false, error: 'Model file must be a JSON object.' };

  if (!Array.isArray(raw.places) || !Array.isArray(raw.transitions)) {
    return { ok: false, error: wrongFormatMessage(OCPN_FORMAT, raw) };
  }

  const objectTypes = parseObjectTypeDefs(raw.objectTypes ?? []);
  if (!objectTypes) {
    return { ok: false, error: '"objectTypes" must be a list of uniquely named types.' };
  }
  const typeNames = new Set(objectTypes.map((t) => t.name));

  const nodeIds = new Set<string>();

  const places: OcpnPlace[] = [];
  for (const [index, entry] of raw.places.entries()) {
    if (!isRecord(entry)) return { ok: false, error: `Place #${index + 1} must be an object.` };
    const id = asName(entry.id);
    if (!id) return { ok: false, error: `Place #${index + 1} needs an "id".` };
    if (nodeIds.has(id)) return { ok: false, error: `Duplicate node id "${id}".` };
    nodeIds.add(id);
    const objectType = asName(entry.objectType);
    if (!objectType) {
      return { ok: false, error: `Place "${id}" needs an "objectType" (pt is a total function).` };
    }
    if (!typeNames.has(objectType)) {
      // Be forgiving: auto-register types referenced only by places.
      typeNames.add(objectType);
      objectTypes.push({ name: objectType });
    }
    places.push({
      id,
      objectType,
      initial: entry.initial === true,
      final: entry.final === true,
      position: isXY(entry.position) ? entry.position : undefined,
    });
  }

  const transitions: OcpnTransition[] = [];
  for (const [index, entry] of raw.transitions.entries()) {
    if (!isRecord(entry)) return { ok: false, error: `Transition #${index + 1} must be an object.` };
    const id = asName(entry.id);
    if (!id) return { ok: false, error: `Transition #${index + 1} needs an "id".` };
    if (nodeIds.has(id)) return { ok: false, error: `Duplicate node id "${id}".` };
    nodeIds.add(id);
    const silent = entry.silent === true || entry.label === null;
    const label = typeof entry.label === 'string' ? entry.label : null;
    transitions.push({
      id,
      // Keep a provided label even for silent transitions so toggling silent
      // off after a save/load round trip restores the original name.
      label: silent ? label : (label ?? id),
      silent,
      position: isXY(entry.position) ? entry.position : undefined,
    });
  }

  const placeIds = new Set(places.map((p) => p.id));
  const transitionIds = new Set(transitions.map((t) => t.id));

  const arcsRaw = raw.arcs ?? [];
  if (!Array.isArray(arcsRaw)) return { ok: false, error: '"arcs" must be an array.' };
  const arcs: OcpnArc[] = [];
  const seenArcs = new Set<string>();
  const seenArcIds = new Set<string>();
  for (const [index, entry] of arcsRaw.entries()) {
    if (!isRecord(entry)) return { ok: false, error: `Arc #${index + 1} must be an object.` };
    const source = asName(entry.source);
    const target = asName(entry.target);
    if (!source || !target) {
      return { ok: false, error: `Arc #${index + 1} needs "source" and "target".` };
    }
    const sourceIsPlace = placeIds.has(source);
    const sourceIsTransition = transitionIds.has(source);
    const targetIsPlace = placeIds.has(target);
    const targetIsTransition = transitionIds.has(target);
    if (!sourceIsPlace && !sourceIsTransition) {
      return { ok: false, error: `Arc #${index + 1} references unknown node "${source}".` };
    }
    if (!targetIsPlace && !targetIsTransition) {
      return { ok: false, error: `Arc #${index + 1} references unknown node "${target}".` };
    }
    if (sourceIsPlace === targetIsPlace) {
      return {
        ok: false,
        error: `Arc #${index + 1} (${source} → ${target}) is not allowed: arcs must connect a place and a transition.`,
      };
    }
    const arcKey = JSON.stringify([source, target]);
    if (seenArcs.has(arcKey)) {
      return { ok: false, error: `Duplicate arc ${source} → ${target}.` };
    }
    seenArcs.add(arcKey);
    let arcId = typeof entry.id === 'string' && entry.id ? entry.id : `arc-${index + 1}`;
    while (seenArcIds.has(arcId)) arcId = `${arcId}-dup`;
    seenArcIds.add(arcId);
    // Waypoints are a layout hint only — be forgiving and keep just the
    // well-formed points instead of rejecting the file.
    const waypoints = Array.isArray(entry.waypoints)
      ? entry.waypoints.filter(isXY).map((p) => ({ x: p.x, y: p.y }))
      : [];
    arcs.push({
      id: arcId,
      source,
      target,
      variable: entry.variable === true,
      waypoints: waypoints.length > 0 ? waypoints : undefined,
    });
  }

  // Well-formedness (Def. 5.2): per transition and object type, arcs are
  // uniformly variable or uniformly non-variable. Normalise ill-formed input
  // towards variable and report it.
  const warnings: string[] = [];
  const placeTypeById = new Map(places.map((p) => [p.id, p.objectType]));
  const arcGroups = new Map<
    string,
    { transition: string; objectType: string; arcs: OcpnArc[] }
  >();
  for (const arc of arcs) {
    const transition = transitionIds.has(arc.source) ? arc.source : arc.target;
    const place = transitionIds.has(arc.source) ? arc.target : arc.source;
    const objectType = placeTypeById.get(place) ?? '';
    const key = JSON.stringify([transition, objectType]);
    const group = arcGroups.get(key);
    if (group) group.arcs.push(arc);
    else arcGroups.set(key, { transition, objectType, arcs: [arc] });
  }
  for (const group of arcGroups.values()) {
    const variableCount = group.arcs.filter((arc) => arc.variable).length;
    if (variableCount > 0 && variableCount < group.arcs.length) {
      for (const arc of group.arcs) arc.variable = true;
      warnings.push(
        `Made all ${group.arcs.length} arcs between "${group.transition}" and its "${group.objectType}" places variable (well-formedness).`,
      );
    }
  }

  return {
    ok: true,
    model: {
      format: OCPN_FORMAT,
      version: 1,
      name: asName(raw.name) ?? 'Object-centric Petri net',
      objectTypes,
      places,
      transitions,
      arcs,
    },
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export function parseOccnModelFile(raw: unknown): ParseResult<OccnModelFile> {
  if (!isRecord(raw)) return { ok: false, error: 'Model file must be a JSON object.' };

  if (!isRecord(raw.markerGroups) && !Array.isArray(raw.activities)) {
    return { ok: false, error: wrongFormatMessage(OCCN_FORMAT, raw) };
  }

  const objectTypes = parseObjectTypeDefs(raw.objectTypes ?? []);
  if (!objectTypes) {
    return { ok: false, error: '"objectTypes" must be a list of uniquely named types.' };
  }
  const typeNames = new Set(objectTypes.map((t) => t.name));
  const registerType = (name: string) => {
    if (!typeNames.has(name)) {
      typeNames.add(name);
      objectTypes.push({ name });
    }
  };

  const activities: OccnActivity[] = [];
  const activityNames = new Set<string>();
  const registerActivity = (name: string, position?: XY) => {
    if (activityNames.has(name)) return;
    activityNames.add(name);
    activities.push({ name, position });
  };

  const activitiesRaw = raw.activities ?? [];
  if (!Array.isArray(activitiesRaw)) return { ok: false, error: '"activities" must be an array.' };
  for (const entry of activitiesRaw) {
    const name = isRecord(entry) ? asName(entry.name) : asName(entry);
    if (!name) return { ok: false, error: 'Every activity needs a non-empty "name".' };
    if (activityNames.has(name)) return { ok: false, error: `Duplicate activity "${name}".` };
    registerActivity(name, isRecord(entry) && isXY(entry.position) ? entry.position : undefined);
  }

  // Marker groups — format of OCCausalNet.from_dict.
  // Null prototype: activity names are user data ("__proto__" etc. must be
  // ordinary keys, not prototype mutations).
  const markerGroups: Record<string, OccnActivityBindings> = Object.create(null);
  const markerGroupsRaw = isRecord(raw.markerGroups) ? raw.markerGroups : {};
  for (const [activity, bindingsRaw] of Object.entries(markerGroupsRaw)) {
    if (!isRecord(bindingsRaw)) {
      return { ok: false, error: `markerGroups["${activity}"] must be an object with "img"/"omg".` };
    }
    registerActivity(activity);
    const parseGroups = (value: unknown, key: 'img' | 'omg'): OccnMarkerGroup[] | string => {
      if (value === undefined) return [];
      if (!Array.isArray(value)) return `markerGroups["${activity}"].${key} must be an array of groups.`;
      const groups: OccnMarkerGroup[] = [];
      for (const groupRaw of value) {
        if (!Array.isArray(groupRaw) || groupRaw.length === 0) {
          return `markerGroups["${activity}"].${key} contains an empty or invalid group.`;
        }
        const group: OccnMarkerGroup = [];
        for (const markerRaw of groupRaw) {
          if (!Array.isArray(markerRaw) || markerRaw.length < 3) {
            return `markerGroups["${activity}"].${key}: markers must be [activity, objectType, [min, max], key].`;
          }
          const related = asName(markerRaw[0]);
          const objectType = asName(markerRaw[1]);
          const range = markerRaw[2];
          const markerKey = markerRaw.length > 3 ? markerRaw[3] : 0;
          if (
            !related ||
            !objectType ||
            !Array.isArray(range) ||
            range.length !== 2 ||
            typeof range[0] !== 'number' ||
            typeof markerKey !== 'number' ||
            !Number.isFinite(markerKey)
          ) {
            return `markerGroups["${activity}"].${key}: markers must be [activity, objectType, [min, max], key].`;
          }
          const min = range[0];
          // Unbounded max: -1 is canonical; also accept null/Infinity (JSON
          // serialisers turn Infinity into null) so such files stay loadable.
          const max =
            range[1] === null || range[1] === Infinity ? -1 : range[1];
          if (typeof max !== 'number' || !Number.isFinite(max)) {
            return `markerGroups["${activity}"].${key}: invalid count range max ${String(range[1])}.`;
          }
          if (!Number.isFinite(min) || min < 0 || (max !== -1 && max < min)) {
            return `markerGroups["${activity}"].${key}: invalid count range [${min}, ${max}].`;
          }
          registerActivity(related);
          registerType(objectType);
          group.push([related, objectType, [min, max], markerKey]);
        }
        groups.push(group);
      }
      return groups;
    };

    const img = parseGroups(bindingsRaw.img, 'img');
    if (typeof img === 'string') return { ok: false, error: img };
    const omg = parseGroups(bindingsRaw.omg, 'omg');
    if (typeof omg === 'string') return { ok: false, error: omg };
    markerGroups[activity] = { img, omg };
  }

  // Dependency arcs: explicit ones plus arcs implied by output marker groups.
  const arcs: OccnArc[] = [];
  const arcKeys = new Set<string>();
  const addArc = (source: string, target: string, objectType: string) => {
    const key = JSON.stringify([source, target, objectType]);
    if (arcKeys.has(key)) return;
    arcKeys.add(key);
    arcs.push({ source, target, objectType });
  };

  const arcsRaw = raw.arcs ?? [];
  if (!Array.isArray(arcsRaw)) return { ok: false, error: '"arcs" must be an array.' };
  for (const [index, entry] of arcsRaw.entries()) {
    if (!isRecord(entry)) return { ok: false, error: `Arc #${index + 1} must be an object.` };
    const source = asName(entry.source);
    const target = asName(entry.target);
    const objectType = asName(entry.objectType);
    if (!source || !target || !objectType) {
      return { ok: false, error: `Arc #${index + 1} needs "source", "target" and "objectType".` };
    }
    registerActivity(source);
    registerActivity(target);
    registerType(objectType);
    addArc(source, target, objectType);
  }
  for (const [activity, bindings] of Object.entries(markerGroups)) {
    for (const group of bindings.omg ?? []) {
      for (const [related, objectType] of group) {
        addArc(activity, related, objectType);
      }
    }
    for (const group of bindings.img ?? []) {
      for (const [related, objectType] of group) {
        addArc(related, activity, objectType);
      }
    }
  }

  return {
    ok: true,
    model: {
      format: OCCN_FORMAT,
      version: 1,
      name: asName(raw.name) ?? 'Object-centric causal net',
      objectTypes,
      activities,
      arcs,
      markerGroups,
    },
  };
}
