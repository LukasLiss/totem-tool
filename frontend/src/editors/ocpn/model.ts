import {
  OCPN_FORMAT,
  type OcpnArc,
  type OcpnModelFile,
  type OcpnPlace,
  type OcpnTransition,
} from '@/editors/shared/model-types';
import { assignTypeColors } from '@/editors/shared/colors';

import {
  PLACE_SIZE,
  SILENT_HEIGHT,
  SILENT_WIDTH,
  TRANSITION_HEIGHT,
  TRANSITION_WIDTH,
  isPlaceNode,
  type ArcFlowEdge,
  type OcpnFlowNode,
  type OcpnObjectType,
  type PlaceFlowNode,
  type TransitionFlowNode,
} from './types';

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/** Smallest `${prefix}${n}` (n = 1, 2, …) not contained in `used`. */
export function nextFreeId(prefix: string, used: Iterable<string>): string {
  const usedSet = new Set(used);
  let n = 1;
  while (usedSet.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

export const nodeIds = (nodes: OcpnFlowNode[]) => nodes.map((n) => n.id);

// ---------------------------------------------------------------------------
// Model file ↔ React Flow state
// ---------------------------------------------------------------------------

export function nodeSize(node: OcpnFlowNode): { width: number; height: number } {
  if (isPlaceNode(node)) return { width: PLACE_SIZE, height: PLACE_SIZE };
  return node.data.silent
    ? { width: SILENT_WIDTH, height: SILENT_HEIGHT }
    : { width: TRANSITION_WIDTH, height: TRANSITION_HEIGHT };
}

/** Fallback layout for nodes without a stored position: a simple grid. */
function fallbackPosition(index: number): { x: number; y: number } {
  const columns = 6;
  return { x: (index % columns) * 180, y: Math.floor(index / columns) * 130 };
}

export type FlowState = {
  objectTypes: OcpnObjectType[];
  nodes: OcpnFlowNode[];
  edges: ArcFlowEdge[];
};

/** Build editor state from a (validated) model file. */
export function modelToFlow(model: OcpnModelFile): FlowState {
  const colors = assignTypeColors(model.objectTypes);
  const objectTypes: OcpnObjectType[] = model.objectTypes.map((t) => ({
    name: t.name,
    color: colors[t.name],
  }));

  let fallbackIndex = 0;
  const takePosition = (position?: { x: number; y: number }) =>
    position ?? fallbackPosition(fallbackIndex++);

  const placeNodes: PlaceFlowNode[] = model.places.map((place) => ({
    id: place.id,
    type: 'place',
    position: takePosition(place.position),
    data: {
      objectType: place.objectType,
      color: colors[place.objectType] ?? '#64748B',
      initial: place.initial === true,
      final: place.final === true,
    },
  }));

  const transitionNodes: TransitionFlowNode[] = model.transitions.map((transition) => ({
    id: transition.id,
    type: 'transition',
    position: takePosition(transition.position),
    data: {
      label: transition.silent ? (transition.label ?? '') : (transition.label ?? transition.id),
      silent: transition.silent === true,
      typeDotColors: [],
    },
  }));

  const nodes: OcpnFlowNode[] = [...placeNodes, ...transitionNodes];

  const edges: ArcFlowEdge[] = model.arcs.map((arc) => ({
    id: arc.id,
    type: 'arc',
    source: arc.source,
    target: arc.target,
    data: {
      variable: arc.variable === true,
      color: '#64748B',
      objectType: '',
      waypoints: arc.waypoints,
    },
  }));

  return { objectTypes, nodes, edges };
}

/** Serialize the editor state back into the JSON file format. */
export function flowToModel(
  name: string,
  objectTypes: OcpnObjectType[],
  nodes: OcpnFlowNode[],
  edges: ArcFlowEdge[],
): OcpnModelFile {
  const places: OcpnPlace[] = [];
  const transitions: OcpnTransition[] = [];
  for (const node of nodes) {
    const position = { x: node.position.x, y: node.position.y };
    if (isPlaceNode(node)) {
      places.push({
        id: node.id,
        objectType: node.data.objectType,
        initial: node.data.initial || undefined,
        final: node.data.final || undefined,
        position,
      });
    } else {
      transitions.push({
        id: node.id,
        // Silent transitions keep their remembered label (silent: true marks
        // them as τ) so toggling silent off after a save/load round trip
        // restores the name; label is null only when there is none.
        label: node.data.silent ? node.data.label || null : node.data.label,
        silent: node.data.silent || undefined,
        position,
      });
    }
  }
  const arcs: OcpnArc[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    variable: edge.data?.variable ? true : undefined,
    // Layout hint only — omitted entirely when the arc has no bend points so
    // consumers that only care about the net never see the field.
    waypoints:
      edge.data?.waypoints && edge.data.waypoints.length > 0
        ? edge.data.waypoints.map((p) => ({ x: p.x, y: p.y }))
        : undefined,
  }));
  return {
    format: OCPN_FORMAT,
    version: 1,
    name,
    objectTypes: objectTypes.map((t) => ({ name: t.name, color: t.color })),
    places,
    transitions,
    arcs,
  };
}

export function emptyModel(name: string): OcpnModelFile {
  return {
    format: OCPN_FORMAT,
    version: 1,
    name,
    objectTypes: [],
    places: [],
    transitions: [],
    arcs: [],
  };
}

// ---------------------------------------------------------------------------
// Well-formedness (Def. 5.2)
// ---------------------------------------------------------------------------

/** Map place id → object type. */
export function placeTypeMap(nodes: OcpnFlowNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    if (isPlaceNode(node)) map.set(node.id, node.data.objectType);
  }
  return map;
}

/** Id of the transition endpoint of an arc (arcs are bipartite). */
export const arcTransitionId = (edge: ArcFlowEdge, placeTypes: Map<string, string>) =>
  placeTypes.has(edge.source) ? edge.target : edge.source;

/** Object type of the place endpoint of an arc. */
export const arcObjectType = (edge: ArcFlowEdge, placeTypes: Map<string, string>) =>
  placeTypes.get(placeTypes.has(edge.source) ? edge.source : edge.target);

/**
 * Set `variable` on one arc and propagate the value to every other arc
 * between the same transition and places of the same object type
 * (well-formedness, Def. 5.2). Returns the new edge list and how many OTHER
 * arcs had to be updated.
 */
export function setArcVariable(
  edges: ArcFlowEdge[],
  placeTypes: Map<string, string>,
  edgeId: string,
  variable: boolean,
): { edges: ArcFlowEdge[]; othersChanged: number } {
  const toggled = edges.find((e) => e.id === edgeId);
  if (!toggled) return { edges, othersChanged: 0 };
  const transition = arcTransitionId(toggled, placeTypes);
  const objectType = arcObjectType(toggled, placeTypes);
  let othersChanged = 0;
  const next = edges.map((edge) => {
    const inGroup =
      arcTransitionId(edge, placeTypes) === transition &&
      arcObjectType(edge, placeTypes) === objectType;
    if (!inGroup || (edge.data?.variable === true) === variable) return edge;
    if (edge.id !== edgeId) othersChanged += 1;
    return { ...edge, data: { ...edge.data!, variable } };
  });
  return { edges: next, othersChanged };
}

/**
 * Re-establish well-formedness for the groups (transition × object type)
 * touched by the given transitions: if a group mixes variable and
 * non-variable arcs, ALL arcs of the group become variable. Used after a
 * place changes its object type. Returns the number of arcs updated.
 */
export function normalizeTransitions(
  edges: ArcFlowEdge[],
  placeTypes: Map<string, string>,
  transitionIds: Set<string>,
): { edges: ArcFlowEdge[]; changed: number } {
  // group key → has variable arc?
  const groupHasVariable = new Map<string, boolean>();
  const groupKey = (edge: ArcFlowEdge) =>
    `${arcTransitionId(edge, placeTypes)}\u0000${arcObjectType(edge, placeTypes)}`;
  for (const edge of edges) {
    if (!transitionIds.has(arcTransitionId(edge, placeTypes))) continue;
    const key = groupKey(edge);
    groupHasVariable.set(key, (groupHasVariable.get(key) ?? false) || edge.data?.variable === true);
  }
  let changed = 0;
  const next = edges.map((edge) => {
    if (!transitionIds.has(arcTransitionId(edge, placeTypes))) return edge;
    const shouldBeVariable = groupHasVariable.get(groupKey(edge)) === true;
    if ((edge.data?.variable === true) === shouldBeVariable) return edge;
    changed += 1;
    return { ...edge, data: { ...edge.data!, variable: shouldBeVariable } };
  });
  return { edges: next, changed };
}

// ---------------------------------------------------------------------------
// Example model — order/item/route fulfilment (paper Fig. 4)
// ---------------------------------------------------------------------------

export function exampleModel(): OcpnModelFile {
  const place = (
    id: string,
    objectType: string,
    x: number,
    y: number,
    flags: { initial?: boolean; final?: boolean } = {},
  ): OcpnPlace => ({ id, objectType, ...flags, position: { x, y } });

  const transition = (id: string, label: string, x: number, y: number): OcpnTransition => ({
    id,
    label,
    position: { x, y },
  });

  const arc = (source: string, target: string, variable = false): OcpnArc => ({
    id: `a_${source}_${target}`,
    source,
    target,
    variable: variable || undefined,
  });

  // Three horizontal lanes: Order (top), Item (middle), Route (bottom).
  const ORDER_Y = 0;
  const ITEM_Y = 230;
  const ROUTE_Y = 460;

  return {
    format: OCPN_FORMAT,
    version: 1,
    name: 'Order fulfilment',
    objectTypes: [
      { name: 'Order', color: '#10B981' },
      { name: 'Item', color: '#2563EB' },
      { name: 'Route', color: '#F59E0B' },
    ],
    places: [
      place('o1', 'Order', 0, ORDER_Y, { initial: true }),
      place('o2', 'Order', 340, ORDER_Y),
      place('o3', 'Order', 680, ORDER_Y),
      place('o4', 'Order', 1700, ORDER_Y, { final: true }),
      place('i1', 'Item', 0, ITEM_Y, { initial: true }),
      place('i2', 'Item', 340, ITEM_Y),
      place('i3', 'Item', 680, ITEM_Y),
      place('i4', 'Item', 1020, ITEM_Y),
      place('i5', 'Item', 1360, ITEM_Y),
      place('i6', 'Item', 1700, ITEM_Y, { final: true }),
      place('r1', 'Route', 0, ROUTE_Y, { initial: true }),
      place('r2', 'Route', 1020, ROUTE_Y),
      place('r3', 'Route', 1360, ROUTE_Y, { final: true }),
    ],
    transitions: [
      // Shared transitions sit between the lanes they connect.
      transition('t_place', 'place order', 130, (ORDER_Y + ITEM_Y) / 2 + 24),
      transition('t_pay', 'pay order', 470, ORDER_Y - 2),
      transition('t_pick', 'pick item', 470, ITEM_Y - 2),
      transition('t_start', 'start route', 810, (ITEM_Y + ROUTE_Y) / 2 + 24),
      transition('t_end', 'end route', 1150, (ITEM_Y + ROUTE_Y) / 2 + 24),
      transition('t_complete', 'complete order', 1490, (ORDER_Y + ITEM_Y) / 2 + 24),
    ],
    arcs: [
      // Order chain (one order per event → non-variable).
      arc('o1', 't_place'),
      arc('t_place', 'o2'),
      arc('o2', 't_pay'),
      arc('t_pay', 'o3'),
      arc('o3', 't_complete'),
      arc('t_complete', 'o4'),
      // Item chain (place order / start route / end route / complete order
      // handle SETS of items → variable; pick item handles one item).
      arc('i1', 't_place', true),
      arc('t_place', 'i2', true),
      arc('i2', 't_pick'),
      arc('t_pick', 'i3'),
      arc('i3', 't_start', true),
      arc('t_start', 'i4', true),
      arc('i4', 't_end', true),
      arc('t_end', 'i5', true),
      arc('i5', 't_complete', true),
      arc('t_complete', 'i6', true),
      // Route chain.
      arc('r1', 't_start'),
      arc('t_start', 'r2'),
      arc('r2', 't_end'),
      arc('t_end', 'r3'),
    ],
  };
}
