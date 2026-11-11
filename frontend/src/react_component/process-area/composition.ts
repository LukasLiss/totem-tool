/**
 * Process-area compositions: a stack of levels, each holding named process
 * areas, each grouping object types and activities.
 *
 * A composition starts as the result of a discovery (`compositionFromLayers`)
 * and is then adjusted by hand in the Process Area editor. Every edit is a
 * pure function here, so the editor is a thin view and the rules are tested
 * in isolation. The asset format (`toAssetContent` / `fromAssetContent`) is
 * what is stored in the project asset store as a `PROCESS_AREAS` asset and
 * validated by `backend/api/asset_formats.py`.
 *
 * Levels are an array with index 0 at the bottom: level 0 holds the core
 * business objects, resources sit higher up. That matches the discovery
 * algorithms and the visualizer, which draws the highest level on top.
 */

export const PROCESS_AREAS_ASSET_SCHEMA = 'process-areas';
export const PROCESS_AREAS_ASSET_VERSION = 1;
export const AREA_NAME_MAX_LENGTH = 100;

export type CompositionArea = {
  /** Stable id; survives renames so references to the area keep working. */
  id: string;
  name: string;
  objectTypes: string[];
  activities: string[];
};

export type CompositionLevel = {
  /** Only for React keys; the level number is the index in `levels`. */
  key: string;
  areas: CompositionArea[];
};

export type CompositionSource = {
  kind: 'discovered' | 'asset';
  algorithm?: string;
  fileId?: number;
  assetId?: number;
};

export type ProcessAreaComposition = {
  name: string;
  description: string;
  /** Index 0 = level 0 (bottom). */
  levels: CompositionLevel[];
  /** Object types of the log that are in no process area. */
  unassigned: string[];
  source?: CompositionSource;
};

/** Where an object type (or a whole area) can be dropped. */
export type DropTarget =
  | { kind: 'area'; areaId: string }
  | { kind: 'newArea'; levelIndex: number }
  | { kind: 'unassigned' };

/** The shape both discovery endpoints return (see `_serialize_process_layers`). */
export type DiscoveredLayer = {
  level: number;
  areas: Array<{ objectTypes: string[]; eventTypes?: string[] }>;
};

/** Layer shape the visualizer and the shared process-area store use. */
export type VisualLayer = {
  level: number;
  areas: Array<{
    id: string;
    level: number;
    label: string;
    name: string;
    objectTypes: string[];
    activities: string[];
  }>;
};

let idCounter = 0;
/** A fresh id for a new area or level. */
export function newId(prefix: string): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${random}`;
}

const byName = (a: string, b: string) => a.localeCompare(b);

/** The name an area gets until the user names it: its object types. */
export function autoAreaName(objectTypes: string[]): string {
  if (objectTypes.length === 0) return 'Empty process area';
  return [...objectTypes].sort(byName).join(' & ');
}

/** Same discovered id scheme as `buildLayersFromBackend` / `fetchProcessAreas`. */
export function discoveredAreaId(level: number, index: number, objectTypes: string[]): string {
  return `level-${level}-area-${index}-${objectTypes.join('-')}`;
}

function uniqueName(base: string, taken: Set<string>): string {
  let candidate = base.slice(0, AREA_NAME_MAX_LENGTH);
  let n = 2;
  while (taken.has(candidate.toLocaleLowerCase())) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, AREA_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    n += 1;
  }
  return candidate;
}

/* ------------------------------------------------------------------ */
/* Construction                                                       */
/* ------------------------------------------------------------------ */

/**
 * A composition from a discovery result. Discovery levels need not be
 * contiguous (MLPA can skip numbers); they are compacted to 0..n-1 in order.
 */
export function compositionFromLayers(
  layers: DiscoveredLayer[],
  options: {
    name?: string;
    allObjectTypes?: string[];
    source?: CompositionSource;
  } = {},
): ProcessAreaComposition {
  const sorted = [...layers].sort((a, b) => a.level - b.level);
  const taken = new Set<string>();
  const assigned = new Set<string>();
  const levels: CompositionLevel[] = sorted.map((layer) => ({
    key: newId('level'),
    areas: layer.areas
      .map((area, index) => ({ area, index }))
      .filter(({ area }) => area.objectTypes.length > 0)
      .map(({ area, index }) => {
        const name = uniqueName(autoAreaName(area.objectTypes), taken);
        taken.add(name.toLocaleLowerCase());
        area.objectTypes.forEach((t) => assigned.add(t));
        return {
          id: discoveredAreaId(layer.level, index, area.objectTypes),
          name,
          objectTypes: [...area.objectTypes].sort(byName),
          activities: [...(area.eventTypes ?? [])].sort(byName),
        };
      }),
  }));
  const unassigned = (options.allObjectTypes ?? [])
    .filter((t) => !assigned.has(t))
    .sort(byName);
  return {
    name: options.name ?? '',
    description: '',
    levels: levels.length > 0 ? levels : [{ key: newId('level'), areas: [] }],
    unassigned,
    source: options.source,
  };
}

/** Deep copy (compositions are small; the editor snapshots them for undo). */
export function cloneComposition(c: ProcessAreaComposition): ProcessAreaComposition {
  return {
    ...c,
    source: c.source ? { ...c.source } : undefined,
    unassigned: [...c.unassigned],
    levels: c.levels.map((level) => ({
      key: level.key,
      areas: level.areas.map((area) => ({
        ...area,
        objectTypes: [...area.objectTypes],
        activities: [...area.activities],
      })),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                            */
/* ------------------------------------------------------------------ */

export function allAreas(c: ProcessAreaComposition): Array<CompositionArea & { levelIndex: number }> {
  return c.levels.flatMap((level, levelIndex) =>
    level.areas.map((area) => ({ ...area, levelIndex })),
  );
}

export function findArea(
  c: ProcessAreaComposition,
  areaId: string,
): { area: CompositionArea; levelIndex: number; areaIndex: number } | null {
  for (let levelIndex = 0; levelIndex < c.levels.length; levelIndex += 1) {
    const areaIndex = c.levels[levelIndex].areas.findIndex((a) => a.id === areaId);
    if (areaIndex >= 0) {
      return { area: c.levels[levelIndex].areas[areaIndex], levelIndex, areaIndex };
    }
  }
  return null;
}

/** Where an object type currently is. */
export function locateObjectType(
  c: ProcessAreaComposition,
  objectType: string,
): { kind: 'area'; areaId: string; levelIndex: number } | { kind: 'unassigned' } | null {
  for (let levelIndex = 0; levelIndex < c.levels.length; levelIndex += 1) {
    const area = c.levels[levelIndex].areas.find((a) => a.objectTypes.includes(objectType));
    if (area) return { kind: 'area', areaId: area.id, levelIndex };
  }
  return c.unassigned.includes(objectType) ? { kind: 'unassigned' } : null;
}

/** Union of the activities of the given object types. */
export function relatedActivities(
  objectTypes: string[],
  objectTypeToActivities: Record<string, string[]>,
): string[] {
  const set = new Set<string>();
  objectTypes.forEach((t) => (objectTypeToActivities[t] ?? []).forEach((a) => set.add(a)));
  return [...set].sort(byName);
}

/** For every activity, the names of the areas that contain it. */
export function activityOwners(c: ProcessAreaComposition): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  allAreas(c).forEach((area) => {
    area.activities.forEach((activity) => {
      const list = owners.get(activity) ?? [];
      list.push(area.name);
      owners.set(activity, list);
    });
  });
  return owners;
}

/* ------------------------------------------------------------------ */
/* Activities                                                         */
/* ------------------------------------------------------------------ */

/**
 * The default activities of one area, by the discovery's rule: every activity
 * of its object types that no area on a lower level already claims.
 */
export function defaultActivitiesForArea(
  c: ProcessAreaComposition,
  areaId: string,
  objectTypeToActivities: Record<string, string[]>,
): string[] {
  const located = findArea(c, areaId);
  if (!located) return [];
  const claimedBelow = new Set<string>();
  c.levels.slice(0, located.levelIndex).forEach((level) =>
    level.areas.forEach((area) =>
      relatedActivities(area.objectTypes, objectTypeToActivities).forEach((a) => claimedBelow.add(a)),
    ),
  );
  return relatedActivities(located.area.objectTypes, objectTypeToActivities).filter(
    (a) => !claimedBelow.has(a),
  );
}

function mapAreas(
  c: ProcessAreaComposition,
  fn: (area: CompositionArea, levelIndex: number) => CompositionArea,
): ProcessAreaComposition {
  return {
    ...c,
    levels: c.levels.map((level, levelIndex) => ({
      ...level,
      areas: level.areas.map((area) => fn(area, levelIndex)),
    })),
  };
}

export function setAreaActivities(
  c: ProcessAreaComposition,
  areaId: string,
  activities: string[],
): ProcessAreaComposition {
  const unique = [...new Set(activities)].sort(byName);
  return mapAreas(c, (area) => (area.id === areaId ? { ...area, activities: unique } : area));
}

export function resetAreaActivities(
  c: ProcessAreaComposition,
  areaId: string,
  objectTypeToActivities: Record<string, string[]>,
): ProcessAreaComposition {
  return setAreaActivities(c, areaId, defaultActivitiesForArea(c, areaId, objectTypeToActivities));
}

/** Reset every area's activities to the default rule. */
export function resetAllActivities(
  c: ProcessAreaComposition,
  objectTypeToActivities: Record<string, string[]>,
): ProcessAreaComposition {
  return mapAreas(c, (area) => ({
    ...area,
    activities: defaultActivitiesForArea(c, area.id, objectTypeToActivities),
  }));
}

/* ------------------------------------------------------------------ */
/* Names                                                              */
/* ------------------------------------------------------------------ */

export function renameComposition(c: ProcessAreaComposition, name: string): ProcessAreaComposition {
  return { ...c, name };
}

export function setDescription(c: ProcessAreaComposition, description: string): ProcessAreaComposition {
  return { ...c, description };
}

export function renameArea(c: ProcessAreaComposition, areaId: string, name: string): ProcessAreaComposition {
  return mapAreas(c, (area) => (area.id === areaId ? { ...area, name } : area));
}

/* ------------------------------------------------------------------ */
/* Levels                                                             */
/* ------------------------------------------------------------------ */

/**
 * Insert an empty level so that it gets number `index` (0 = new bottom
 * level, `levels.length` = new top level). Levels above it move up by one.
 */
export function insertLevel(c: ProcessAreaComposition, index: number): ProcessAreaComposition {
  const at = Math.max(0, Math.min(c.levels.length, index));
  const levels = [...c.levels];
  levels.splice(at, 0, { key: newId('level'), areas: [] });
  return { ...c, levels };
}

/**
 * Remove a level. Its object types become unassigned (the editor asks
 * first when there are any). The last level cannot be removed.
 */
export function removeLevel(c: ProcessAreaComposition, levelIndex: number): ProcessAreaComposition {
  if (c.levels.length <= 1 || levelIndex < 0 || levelIndex >= c.levels.length) return c;
  const removed = c.levels[levelIndex];
  const freed = removed.areas.flatMap((a) => a.objectTypes);
  return {
    ...c,
    levels: c.levels.filter((_, i) => i !== levelIndex),
    unassigned: [...c.unassigned, ...freed].sort(byName),
  };
}

/* ------------------------------------------------------------------ */
/* Moving object types and areas                                      */
/* ------------------------------------------------------------------ */

/**
 * Activities an object type brings into `target`: its activities that are
 * not claimed by an area on a lower level and not already in the target.
 */
function activitiesBroughtIn(
  c: ProcessAreaComposition,
  objectType: string,
  targetLevelIndex: number,
  objectTypeToActivities: Record<string, string[]>,
): string[] {
  const claimedBelow = new Set<string>();
  c.levels.slice(0, targetLevelIndex).forEach((level) =>
    level.areas.forEach((area) => area.activities.forEach((a) => claimedBelow.add(a))),
  );
  return (objectTypeToActivities[objectType] ?? []).filter((a) => !claimedBelow.has(a));
}

/** Rename an area after its object types while the user has not named it. */
function followAutoName(area: CompositionArea, previousTypes: string[]): string {
  return area.name === autoAreaName(previousTypes) ? autoAreaName(area.objectTypes) : area.name;
}

/** Remove a type from wherever it is; empty areas disappear. */
function detachObjectType(
  c: ProcessAreaComposition,
  objectType: string,
  objectTypeToActivities: Record<string, string[]>,
): ProcessAreaComposition {
  const levels = c.levels.map((level) => ({
    ...level,
    areas: level.areas
      .map((area) => {
        if (!area.objectTypes.includes(objectType)) return area;
        const previousTypes = area.objectTypes;
        const objectTypes = area.objectTypes.filter((t) => t !== objectType);
        // Drop the activities only the removed type took part in.
        const stillRelated = new Set(relatedActivities(objectTypes, objectTypeToActivities));
        const ownActivities = new Set(objectTypeToActivities[objectType] ?? []);
        const activities = area.activities.filter((a) => !ownActivities.has(a) || stillRelated.has(a));
        const next = { ...area, objectTypes, activities };
        return { ...next, name: followAutoName(next, previousTypes) };
      })
      .filter((area) => area.objectTypes.length > 0),
  }));
  return { ...c, levels, unassigned: c.unassigned.filter((t) => t !== objectType) };
}

/**
 * Move one object type into an existing area, into a new area of its own on
 * a level, or out of every area. Moving it out of an area onto a level (the
 * `newArea` target) is how an area is split.
 *
 * Activities follow along: the source area loses the activities only this
 * type took part in, the target gains its activities that no lower area
 * already has. Area names follow their object types until the user renames
 * the area.
 */
export function moveObjectType(
  c: ProcessAreaComposition,
  objectType: string,
  target: DropTarget,
  objectTypeToActivities: Record<string, string[]>,
): ProcessAreaComposition {
  const from = locateObjectType(c, objectType);
  if (target.kind === 'area' && from?.kind === 'area' && from.areaId === target.areaId) return c;
  if (target.kind === 'unassigned' && from?.kind === 'unassigned') return c;
  if (target.kind === 'area' && !findArea(c, target.areaId)) return c;
  if (target.kind === 'newArea' && (target.levelIndex < 0 || target.levelIndex >= c.levels.length)) {
    return c;
  }
  // A lone type dropped onto a fresh area of the level it already is on would
  // only change the area id.
  if (target.kind === 'newArea' && from?.kind === 'area' && from.levelIndex === target.levelIndex) {
    const source = findArea(c, from.areaId);
    if (source && source.area.objectTypes.length === 1) return c;
  }

  const detached = detachObjectType(c, objectType, objectTypeToActivities);

  if (target.kind === 'unassigned') {
    return { ...detached, unassigned: [...detached.unassigned, objectType].sort(byName) };
  }

  if (target.kind === 'newArea') {
    const taken = new Set(allAreas(detached).map((a) => a.name.toLocaleLowerCase()));
    const area: CompositionArea = {
      id: newId('pa'),
      name: uniqueName(autoAreaName([objectType]), taken),
      objectTypes: [objectType],
      activities: activitiesBroughtIn(detached, objectType, target.levelIndex, objectTypeToActivities).sort(byName),
    };
    return {
      ...detached,
      levels: detached.levels.map((level, i) =>
        i === target.levelIndex ? { ...level, areas: [...level.areas, area] } : level,
      ),
    };
  }

  const located = findArea(detached, target.areaId);
  if (!located) return c;
  const brought = activitiesBroughtIn(detached, objectType, located.levelIndex, objectTypeToActivities);
  return mapAreas(detached, (area) => {
    if (area.id !== target.areaId) return area;
    const previousTypes = area.objectTypes;
    const next = {
      ...area,
      objectTypes: [...area.objectTypes, objectType].sort(byName),
      activities: [...new Set([...area.activities, ...brought])].sort(byName),
    };
    return { ...next, name: followAutoName(next, previousTypes) };
  });
}

/**
 * Move a whole area: onto another level (`newArea`), merged into another
 * area (`area`), or dissolved (`unassigned`).
 */
export function moveArea(
  c: ProcessAreaComposition,
  areaId: string,
  target: DropTarget,
): ProcessAreaComposition {
  const located = findArea(c, areaId);
  if (!located) return c;
  const { area, levelIndex } = located;

  if (target.kind === 'newArea') {
    if (target.levelIndex === levelIndex || target.levelIndex < 0 || target.levelIndex >= c.levels.length) {
      return c;
    }
    const levels = c.levels.map((level, i) => {
      const areas = level.areas.filter((a) => a.id !== areaId);
      return i === target.levelIndex ? { ...level, areas: [...areas, area] } : { ...level, areas };
    });
    return { ...c, levels };
  }

  if (target.kind === 'unassigned') {
    return {
      ...c,
      levels: c.levels.map((level) => ({ ...level, areas: level.areas.filter((a) => a.id !== areaId) })),
      unassigned: [...c.unassigned, ...area.objectTypes].sort(byName),
    };
  }

  if (target.areaId === areaId || !findArea(c, target.areaId)) return c;
  // Merge: the target keeps its id and name and takes over everything.
  const without: ProcessAreaComposition = {
    ...c,
    levels: c.levels.map((level) => ({ ...level, areas: level.areas.filter((a) => a.id !== areaId) })),
  };
  return mapAreas(without, (other) => {
    if (other.id !== target.areaId) return other;
    const previousTypes = other.objectTypes;
    const next = {
      ...other,
      objectTypes: [...other.objectTypes, ...area.objectTypes].sort(byName),
      activities: [...new Set([...other.activities, ...area.activities])].sort(byName),
    };
    return { ...next, name: followAutoName(next, previousTypes) };
  });
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

export type CompositionProblem = {
  severity: 'error' | 'warning';
  message: string;
  areaId?: string;
};

/** What stands between the composition and saving it (errors), plus hints. */
export function compositionProblems(c: ProcessAreaComposition): CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  if (!c.name.trim()) {
    problems.push({ severity: 'error', message: 'Give the composition a name.' });
  }
  const areas = allAreas(c);
  if (areas.length === 0) {
    problems.push({ severity: 'error', message: 'Add at least one process area.' });
  }
  const seen = new Map<string, string>();
  areas.forEach((area) => {
    const name = area.name.trim();
    if (!name) {
      problems.push({ severity: 'error', message: 'Every process area needs a name.', areaId: area.id });
      return;
    }
    if (name.length > AREA_NAME_MAX_LENGTH) {
      problems.push({
        severity: 'error',
        message: `"${name.slice(0, 24)}…" is longer than ${AREA_NAME_MAX_LENGTH} characters.`,
        areaId: area.id,
      });
    }
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) {
      problems.push({
        severity: 'error',
        message: `Two process areas are called "${name}". Names must be unique so they can be referred to.`,
        areaId: area.id,
      });
    } else {
      seen.set(key, area.id);
    }
    if (area.activities.length === 0) {
      problems.push({
        severity: 'warning',
        message: `"${name}" has no activities, so it has no process executions.`,
        areaId: area.id,
      });
    }
  });
  const emptyLevels = c.levels.filter((level) => level.areas.length === 0).length;
  if (emptyLevels > 0 && areas.length > 0) {
    problems.push({
      severity: 'warning',
      message: `${emptyLevels} empty level${emptyLevels === 1 ? '' : 's'} will be dropped when the composition is applied.`,
    });
  }
  if (c.unassigned.length > 0) {
    problems.push({
      severity: 'warning',
      message: `${c.unassigned.length} object type${c.unassigned.length === 1 ? ' is' : 's are'} in no process area.`,
    });
  }
  return problems;
}

export function hasBlockingProblems(c: ProcessAreaComposition): boolean {
  return compositionProblems(c).some((p) => p.severity === 'error');
}

/** Empty levels removed (they carry no information once applied). */
export function withoutEmptyLevels(c: ProcessAreaComposition): ProcessAreaComposition {
  const levels = c.levels.filter((level) => level.areas.length > 0);
  return { ...c, levels: levels.length > 0 ? levels : c.levels.slice(0, 1) };
}

/* ------------------------------------------------------------------ */
/* Conversions                                                        */
/* ------------------------------------------------------------------ */

/**
 * Layers for the visualizer, highest level first (the order it draws in),
 * with the area names as labels.
 */
export function compositionToLayers(c: ProcessAreaComposition): VisualLayer[] {
  const compact = withoutEmptyLevels(c);
  return compact.levels
    .map((level, levelIndex) => ({
      level: levelIndex,
      areas: level.areas.map((area) => ({
        id: area.id,
        level: levelIndex,
        label: area.name.trim() || autoAreaName(area.objectTypes),
        name: area.name.trim() || autoAreaName(area.objectTypes),
        objectTypes: [...area.objectTypes],
        activities: [...area.activities],
      })),
    }))
    .filter((layer) => layer.areas.length > 0)
    .reverse();
}

export type ProcessAreasAssetContent = {
  schema: typeof PROCESS_AREAS_ASSET_SCHEMA;
  version: typeof PROCESS_AREAS_ASSET_VERSION;
  description: string;
  levels: Array<{
    level: number;
    areas: Array<{ id: string; name: string; objectTypes: string[]; activities: string[] }>;
  }>;
  unassignedObjectTypes: string[];
  source?: Record<string, unknown>;
};

/** The JSON stored in a PROCESS_AREAS project asset (the name is the asset's). */
export function toAssetContent(c: ProcessAreaComposition): ProcessAreasAssetContent {
  const compact = withoutEmptyLevels(c);
  const content: ProcessAreasAssetContent = {
    schema: PROCESS_AREAS_ASSET_SCHEMA,
    version: PROCESS_AREAS_ASSET_VERSION,
    description: compact.description,
    levels: compact.levels.map((level, levelIndex) => ({
      level: levelIndex,
      areas: level.areas.map((area) => ({
        id: area.id,
        name: area.name.trim(),
        objectTypes: [...area.objectTypes],
        activities: [...area.activities],
      })),
    })),
    unassignedObjectTypes: [...compact.unassigned],
  };
  if (c.source?.algorithm || c.source?.fileId) {
    content.source = {
      ...(c.source.algorithm ? { algorithm: c.source.algorithm } : {}),
      ...(c.source.fileId ? { fileId: c.source.fileId } : {}),
    };
  }
  return content;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];
}

/**
 * A composition from stored asset JSON. Tolerant: malformed parts are
 * skipped rather than thrown on, since the backend validated on save.
 */
export function fromAssetContent(
  content: Record<string, unknown> | null | undefined,
  options: { name: string; assetId?: number; allObjectTypes?: string[] },
): ProcessAreaComposition {
  const rawLevels = Array.isArray(content?.levels) ? (content!.levels as unknown[]) : [];
  const parsed = rawLevels
    .map((raw, index) => {
      const level = (raw ?? {}) as Record<string, unknown>;
      const number = typeof level.level === 'number' ? level.level : index;
      const areas = (Array.isArray(level.areas) ? level.areas : [])
        .map((rawArea, areaIndex) => {
          const area = (rawArea ?? {}) as Record<string, unknown>;
          const objectTypes = stringList(area.objectTypes).sort(byName);
          if (objectTypes.length === 0) return null;
          return {
            id: typeof area.id === 'string' && area.id ? area.id : discoveredAreaId(number, areaIndex, objectTypes),
            name: typeof area.name === 'string' && area.name.trim() ? area.name : autoAreaName(objectTypes),
            objectTypes,
            activities: stringList(area.activities).sort(byName),
          } satisfies CompositionArea;
        })
        .filter((a): a is CompositionArea => a !== null);
      return { number, areas };
    })
    .sort((a, b) => a.number - b.number);

  const levels: CompositionLevel[] = parsed.map((level) => ({ key: newId('level'), areas: level.areas }));
  const assigned = new Set(levels.flatMap((l) => l.areas.flatMap((a) => a.objectTypes)));
  const unassigned = new Set(stringList(content?.unassignedObjectTypes).filter((t) => !assigned.has(t)));
  (options.allObjectTypes ?? []).forEach((t) => {
    if (!assigned.has(t)) unassigned.add(t);
  });
  return {
    name: options.name,
    description: typeof content?.description === 'string' ? content.description : '',
    levels: levels.length > 0 ? levels : [{ key: newId('level'), areas: [] }],
    unassigned: [...unassigned].sort(byName),
    source: { kind: 'asset', assetId: options.assetId },
  };
}

/** Number of areas and levels, for list views. */
export function compositionStats(c: ProcessAreaComposition): { levels: number; areas: number; objectTypes: number } {
  const areas = allAreas(c);
  return {
    levels: c.levels.filter((l) => l.areas.length > 0).length,
    areas: areas.length,
    objectTypes: areas.reduce((n, a) => n + a.objectTypes.length, 0),
  };
}

/** True when both describe the same areas (ignores ids, order and level keys). */
export function sameComposition(a: ProcessAreaComposition, b: ProcessAreaComposition): boolean {
  const signature = (c: ProcessAreaComposition) =>
    JSON.stringify({
      name: c.name.trim(),
      description: c.description,
      levels: withoutEmptyLevels(c).levels.map((level) =>
        level.areas
          .map((area) => [area.name.trim(), area.objectTypes, area.activities])
          .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
      ),
      unassigned: c.unassigned,
    });
  return signature(a) === signature(b);
}
