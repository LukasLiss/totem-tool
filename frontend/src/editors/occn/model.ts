import ELK from 'elkjs/lib/elk.bundled.js';

import {
  OCCN_FORMAT,
  occnEndActivity,
  occnStartActivity,
  type OccnActivityBindings,
  type OccnArc,
  type OccnMarker,
  type OccnMarkerGroup,
  type OccnModelFile,
  type XY,
} from '@/editors/shared/model-types';

import {
  ACTIVITY_HEIGHT,
  ACTIVITY_WIDTH,
  PSEUDO_HEIGHT,
  PSEUDO_WIDTH,
  type ActivityBindings,
  type BindingsMap,
  type OccnNodeKind,
} from './types';

// ---------------------------------------------------------------------------
// Bindings helpers (all immutable — they return new structures)
// ---------------------------------------------------------------------------

/**
 * Count range max: -1 is the canonical "unbounded". Map any non-finite value
 * (Infinity, NaN — JSON.stringify would turn them into null and break the
 * exported file) to -1 so neither the state nor the export ever carries them.
 */
const sanitizeMax = (max: number): number => (Number.isFinite(max) ? max : -1);

const cloneGroups = (groups: OccnMarkerGroup[] | undefined): OccnMarkerGroup[] =>
  (groups ?? []).map((group) =>
    group.map(
      ([related, objectType, [min, max], key]): OccnMarker => [
        related,
        objectType,
        [min, sanitizeMax(max)],
        key,
      ],
    ),
  );

export const cloneBindings = (bindings: BindingsMap): BindingsMap => {
  // Null prototype: activity names are user data ("__proto__" etc. must be
  // ordinary keys, not prototype mutations).
  const result: BindingsMap = Object.create(null);
  for (const [activity, b] of Object.entries(bindings)) {
    result[activity] = { img: cloneGroups(b.img), omg: cloneGroups(b.omg) };
  }
  return result;
};

/** Normalise parsed bindings and guarantee an entry for every activity. */
export function normalizeBindings(
  raw: Record<string, OccnActivityBindings>,
  activityNames: Iterable<string>,
): BindingsMap {
  const result: BindingsMap = Object.create(null);
  for (const name of activityNames) result[name] = { img: [], omg: [] };
  for (const [activity, b] of Object.entries(raw)) {
    result[activity] = { img: cloneGroups(b.img), omg: cloneGroups(b.omg) };
  }
  return result;
}

/** Drop empty groups (and keep the totem_lib from_dict shape) for export. */
export function pruneBindings(bindings: BindingsMap): Record<string, OccnActivityBindings> {
  const result: Record<string, OccnActivityBindings> = Object.create(null);
  for (const [activity, b] of Object.entries(bindings)) {
    result[activity] = {
      img: cloneGroups(b.img).filter((g) => g.length > 0),
      omg: cloneGroups(b.omg).filter((g) => g.length > 0),
    };
  }
  return result;
}

const mapGroups = (
  groups: OccnMarkerGroup[],
  fn: (marker: OccnMarker) => OccnMarker | null,
): OccnMarkerGroup[] =>
  groups
    .map((group) => group.map(fn).filter((m): m is OccnMarker => m !== null))
    .filter((group) => group.length > 0);

const mapBindings = (
  bindings: BindingsMap,
  fn: (marker: OccnMarker, side: 'img' | 'omg', activity: string) => OccnMarker | null,
): BindingsMap => {
  // Null prototype: callers assign renamed activities back into the result
  // (`result[newName] = ...`), which must work for names like "__proto__".
  const result: BindingsMap = Object.create(null);
  for (const [activity, b] of Object.entries(bindings)) {
    result[activity] = {
      img: mapGroups(b.img, (m) => fn(m, 'img', activity)),
      omg: mapGroups(b.omg, (m) => fn(m, 'omg', activity)),
    } satisfies ActivityBindings;
  }
  return result;
};

/** Rename an activity everywhere: bindings key + all `related` references. */
export function renameActivityInBindings(
  bindings: BindingsMap,
  oldName: string,
  newName: string,
): BindingsMap {
  const renamed = mapBindings(bindings, ([related, ot, range, key]) => [
    related === oldName ? newName : related,
    ot,
    [range[0], range[1]],
    key,
  ]);
  if (renamed[oldName]) {
    renamed[newName] = renamed[oldName];
    delete renamed[oldName];
  }
  return renamed;
}

export function renameTypeInBindings(
  bindings: BindingsMap,
  oldType: string,
  newType: string,
): BindingsMap {
  let result = mapBindings(bindings, ([related, ot, range, key]) => [
    related,
    ot === oldType ? newType : ot,
    [range[0], range[1]],
    key,
  ]);
  result = renameActivityInBindings(result, occnStartActivity(oldType), occnStartActivity(newType));
  result = renameActivityInBindings(result, occnEndActivity(oldType), occnEndActivity(newType));
  return result;
}

/** Remove an activity: its own bindings and all markers pointing at it. */
export function removeActivityFromBindings(
  bindings: BindingsMap,
  name: string,
): { bindings: BindingsMap; removedMarkers: number } {
  let removedMarkers = 0;
  const result = mapBindings(bindings, (marker) => {
    if (marker[0] === name) {
      removedMarkers += 1;
      return null;
    }
    return marker;
  });
  delete result[name];
  return { bindings: result, removedMarkers };
}

export function removeTypeFromBindings(
  bindings: BindingsMap,
  type: string,
): { bindings: BindingsMap; removedMarkers: number } {
  let removedMarkers = 0;
  let result = mapBindings(bindings, (marker) => {
    if (marker[1] === type) {
      removedMarkers += 1;
      return null;
    }
    return marker;
  });
  delete result[occnStartActivity(type)];
  delete result[occnEndActivity(type)];
  result = removeActivityFromBindingsRefs(result, occnStartActivity(type)).bindings;
  result = removeActivityFromBindingsRefs(result, occnEndActivity(type)).bindings;
  return { bindings: result, removedMarkers };
}

/** Remove only markers whose `related` is the given activity (keep the key). */
function removeActivityFromBindingsRefs(
  bindings: BindingsMap,
  name: string,
): { bindings: BindingsMap; removedMarkers: number } {
  let removedMarkers = 0;
  const result = mapBindings(bindings, (marker) => {
    if (marker[0] === name) {
      removedMarkers += 1;
      return null;
    }
    return marker;
  });
  return { bindings: result, removedMarkers };
}

/** Remove all markers sitting on the arc (source, target, objectType). */
export function removeArcFromBindings(
  bindings: BindingsMap,
  arc: OccnArc,
): { bindings: BindingsMap; removedMarkers: number } {
  let removedMarkers = 0;
  const result = mapBindings(bindings, (marker, side, activity) => {
    const [related, ot] = marker;
    const onArc =
      ot === arc.objectType &&
      ((side === 'img' && activity === arc.target && related === arc.source) ||
        (side === 'omg' && activity === arc.source && related === arc.target));
    if (onArc) {
      removedMarkers += 1;
      return null;
    }
    return marker;
  });
  return { bindings: result, removedMarkers };
}

/** Move all markers of the arc to a new object type. */
export function retypeArcInBindings(
  bindings: BindingsMap,
  arc: OccnArc,
  newType: string,
): BindingsMap {
  return mapBindings(bindings, (marker, side, activity) => {
    const [related, ot, range, key] = marker;
    const onArc =
      ot === arc.objectType &&
      ((side === 'img' && activity === arc.target && related === arc.source) ||
        (side === 'omg' && activity === arc.source && related === arc.target));
    return onArc ? [related, newType, [range[0], range[1]], key] : marker;
  });
}

/** Groups of `activity` (side) that contain a marker on the given arc. */
export function groupsUsingArc(
  bindings: BindingsMap,
  arc: OccnArc,
  side: 'img' | 'omg',
): number {
  const activity = side === 'img' ? arc.target : arc.source;
  const related = side === 'img' ? arc.source : arc.target;
  const groups = bindings[activity]?.[side] ?? [];
  return groups.filter((group) =>
    group.some((m) => m[0] === related && m[1] === arc.objectType),
  ).length;
}

// ---------------------------------------------------------------------------
// Activity kinds
// ---------------------------------------------------------------------------

export function activityKind(
  name: string,
  typeNames: ReadonlySet<string>,
): { kind: OccnNodeKind; objectType?: string } {
  if (name.startsWith('START_') && typeNames.has(name.slice('START_'.length))) {
    return { kind: 'start', objectType: name.slice('START_'.length) };
  }
  if (name.startsWith('END_') && typeNames.has(name.slice('END_'.length))) {
    return { kind: 'end', objectType: name.slice('END_'.length) };
  }
  return { kind: 'activity' };
}

// ---------------------------------------------------------------------------
// ELK auto layout
// ---------------------------------------------------------------------------

const elk = new ELK();

export async function elkLayeredPositions(
  items: Array<{ id: string; kind: OccnNodeKind }>,
  links: Array<{ source: string; target: string }>,
  opts?: { direction?: 'RIGHT' | 'DOWN'; layerGap?: number; nodeGap?: number },
): Promise<Record<string, XY>> {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': opts?.direction ?? 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(opts?.layerGap ?? 110),
      'elk.spacing.nodeNode': String(opts?.nodeGap ?? 55),
      'elk.spacing.edgeNode': '30',
      'elk.layered.mergeEdges': 'false',
    },
    children: items.map((item) => ({
      id: item.id,
      width: item.kind === 'activity' ? ACTIVITY_WIDTH : PSEUDO_WIDTH,
      height: item.kind === 'activity' ? ACTIVITY_HEIGHT : PSEUDO_HEIGHT,
    })),
    // Self-loops don't influence a layered layout and ELK may choke on them
    // (discovered nets contain self-dependencies); drop them defensively.
    edges: links
      .filter((link) => link.source !== link.target)
      .map((link, index) => ({
        id: `e${index}`,
        sources: [link.source],
        targets: [link.target],
      })),
  };
  const layouted = await elk.layout(graph);
  // Null prototype: keys are activity names (user data, e.g. "__proto__").
  const positions: Record<string, XY> = Object.create(null);
  for (const child of layouted.children ?? []) {
    positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Empty + example model
// ---------------------------------------------------------------------------

export function emptyOccnModel(name: string): OccnModelFile {
  return {
    format: OCCN_FORMAT,
    version: 1,
    name,
    objectTypes: [],
    activities: [],
    arcs: [],
    markerGroups: {},
  };
}

/**
 * Built-in example inspired by the running example of the OCCN paper (Fig. 2):
 * orders are received (b), containers loaded (c) and boxes packed (d); `send`
 * (s) ships either a container with a batch of orders (AND group spanning two
 * arcs, square (1,*) marker) or a single box with one order (second, XOR-
 * alternative group). `review` consumes batches of up to 5 orders.
 */
export function buildOccnExample(): OccnModelFile {
  const order = 'order';
  const container = 'container';
  const box = 'box';
  const b = 'receive order';
  const c = 'load container';
  const d = 'pack box';
  const s = 'send';
  const r = 'review';
  const So = occnStartActivity(order);
  const Eo = occnEndActivity(order);
  const Sc = occnStartActivity(container);
  const Ec = occnEndActivity(container);
  const Sb = occnStartActivity(box);
  const Eb = occnEndActivity(box);

  const pos = (x: number, y: number): XY => ({ x, y });

  return {
    format: OCCN_FORMAT,
    version: 1,
    name: 'Shipping example (OCCN)',
    objectTypes: [
      { name: order, color: '#2563EB' },
      { name: container, color: '#F59E0B' },
      { name: box, color: '#10B981' },
    ],
    activities: [
      { name: Sc, position: pos(40, 40) },
      { name: c, position: pos(240, 48) },
      { name: Ec, position: pos(860, 40) },
      { name: So, position: pos(40, 210) },
      { name: b, position: pos(240, 218) },
      { name: s, position: pos(560, 218) },
      { name: r, position: pos(810, 218) },
      { name: Eo, position: pos(1050, 210) },
      { name: Sb, position: pos(40, 390) },
      { name: d, position: pos(240, 398) },
      { name: Eb, position: pos(860, 390) },
    ],
    arcs: [
      { source: So, target: b, objectType: order },
      { source: b, target: s, objectType: order },
      { source: s, target: r, objectType: order },
      { source: r, target: Eo, objectType: order },
      { source: Sc, target: c, objectType: container },
      { source: c, target: s, objectType: container },
      { source: s, target: Ec, objectType: container },
      { source: Sb, target: d, objectType: box },
      { source: d, target: s, objectType: box },
      { source: s, target: Eb, objectType: box },
    ],
    markerGroups: {
      [So]: { omg: [[[b, order, [1, 1], 0]]] },
      [Sc]: { omg: [[[c, container, [1, 1], 0]]] },
      [Sb]: { omg: [[[d, box, [1, 1], 0]]] },
      [b]: {
        img: [[[So, order, [1, 1], 0]]],
        omg: [[[s, order, [1, 1], 0]]],
      },
      [c]: {
        img: [[[Sc, container, [1, 1], 0]]],
        omg: [[[s, container, [1, 1], 0]]],
      },
      [d]: {
        img: [[[Sb, box, [1, 1], 0]]],
        omg: [[[s, box, [1, 1], 0]]],
      },
      [s]: {
        // Two XOR-alternative input groups; the first is an AND group spanning
        // the container and order arcs with an unbounded (1,*) order marker.
        img: [
          [
            [c, container, [1, 1], 0],
            [b, order, [1, -1], 0],
          ],
          [
            [d, box, [1, 1], 0],
            [b, order, [1, 1], 0],
          ],
        ],
        omg: [
          [
            [r, order, [1, -1], 0],
            [Ec, container, [1, 1], 0],
          ],
          [
            [r, order, [1, -1], 0],
            [Eb, box, [1, 1], 0],
          ],
        ],
      },
      [r]: {
        img: [[[s, order, [1, 5], 0]]],
        omg: [[[Eo, order, [1, 5], 0]]],
      },
      [Eo]: { img: [[[r, order, [1, 1], 0]]] },
      [Ec]: { img: [[[s, container, [1, 1], 0]]] },
      [Eb]: { img: [[[s, box, [1, 1], 0]]] },
    },
  };
}
