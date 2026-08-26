import {
  OCDFG_FORMAT,
  type OcdfgActivity,
  type OcdfgArc,
  type OcdfgControl,
  type OcdfgModelFile,
} from '@/editors/shared/model-types';
import { assignTypeColors } from '@/editors/shared/colors';

import {
  ACTIVITY_HEIGHT,
  ACTIVITY_WIDTH,
  CONTROL_SIZE,
  isControlNode,
  type ActivityFlowNode,
  type ArcFlowEdge,
  type ControlFlowNode,
  type OcdfgFlowNode,
  type OcdfgObjectType,
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

/** Stable id for a START/END node: `start_<type>`, suffixed only on clash. */
export function controlNodeId(
  kind: 'start' | 'end',
  objectType: string,
  used: Iterable<string>,
): string {
  const usedSet = new Set(used);
  const base = `${kind}_${objectType}`;
  if (!usedSet.has(base)) return base;
  let n = 2;
  while (usedSet.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

// ---------------------------------------------------------------------------
// Model file ↔ React Flow state
// ---------------------------------------------------------------------------

export function nodeSize(node: OcdfgFlowNode): { width: number; height: number } {
  if (isControlNode(node)) return { width: CONTROL_SIZE, height: CONTROL_SIZE };
  return { width: ACTIVITY_WIDTH, height: ACTIVITY_HEIGHT };
}

/** Fallback layout for nodes without a stored position: a simple grid. */
function fallbackPosition(index: number): { x: number; y: number } {
  const columns = 6;
  return { x: (index % columns) * 180, y: Math.floor(index / columns) * 130 };
}

export type FlowState = {
  objectTypes: OcdfgObjectType[];
  nodes: OcdfgFlowNode[];
  edges: ArcFlowEdge[];
};

/** Build editor state from a (validated) model file. */
export function modelToFlow(model: OcdfgModelFile): FlowState {
  const colors = assignTypeColors(model.objectTypes);
  const objectTypes: OcdfgObjectType[] = model.objectTypes.map((t) => ({
    name: t.name,
    color: colors[t.name],
  }));

  let fallbackIndex = 0;
  const takePosition = (position?: { x: number; y: number }) =>
    position ?? fallbackPosition(fallbackIndex++);

  const activityNodes: ActivityFlowNode[] = model.activities.map((activity) => ({
    id: activity.id,
    type: 'activity',
    position: takePosition(activity.position),
    data: { label: activity.label, typeDotColors: [] },
  }));

  const controlNode = (control: OcdfgControl, kind: 'start' | 'end'): ControlFlowNode => ({
    id: control.id,
    type: 'control',
    position: takePosition(control.position),
    data: {
      kind,
      objectType: control.objectType,
      color: colors[control.objectType] ?? '#64748B',
    },
  });
  const controlNodes: ControlFlowNode[] = [
    ...model.starts.map((c) => controlNode(c, 'start')),
    ...model.ends.map((c) => controlNode(c, 'end')),
  ];

  const edges: ArcFlowEdge[] = model.arcs.map((arc) => ({
    id: arc.id,
    type: 'arc',
    source: arc.source,
    target: arc.target,
    data: {
      objectType: arc.objectType,
      color: colors[arc.objectType] ?? '#64748B',
      waypoints: arc.waypoints,
    },
  }));

  return { objectTypes, nodes: [...activityNodes, ...controlNodes], edges };
}

/** Serialize the editor state back into the JSON file format. */
export function flowToModel(
  name: string,
  objectTypes: OcdfgObjectType[],
  nodes: OcdfgFlowNode[],
  edges: ArcFlowEdge[],
): OcdfgModelFile {
  const activities: OcdfgActivity[] = [];
  const starts: OcdfgControl[] = [];
  const ends: OcdfgControl[] = [];
  for (const node of nodes) {
    const position = { x: node.position.x, y: node.position.y };
    if (isControlNode(node)) {
      (node.data.kind === 'start' ? starts : ends).push({
        id: node.id,
        objectType: node.data.objectType,
        position,
      });
    } else {
      activities.push({ id: node.id, label: node.data.label, position });
    }
  }
  const arcs: OcdfgArc[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    objectType: edge.data?.objectType ?? '',
    // Layout hint only — omitted entirely when the arc has no bend points so
    // consumers that only care about the graph never see the field.
    waypoints:
      edge.data?.waypoints && edge.data.waypoints.length > 0
        ? edge.data.waypoints.map((p) => ({ x: p.x, y: p.y }))
        : undefined,
  }));
  return {
    format: OCDFG_FORMAT,
    version: 1,
    name,
    objectTypes: objectTypes.map((t) => ({ name: t.name, color: t.color })),
    activities,
    starts,
    ends,
    arcs,
  };
}

export function emptyModel(name: string): OcdfgModelFile {
  return {
    format: OCDFG_FORMAT,
    version: 1,
    name,
    objectTypes: [],
    activities: [],
    starts: [],
    ends: [],
    arcs: [],
  };
}

// ---------------------------------------------------------------------------
// Arc helpers
// ---------------------------------------------------------------------------

/** True if an equal-typed arc between the same nodes already exists. */
export function hasArc(
  edges: ArcFlowEdge[],
  source: string,
  target: string,
  objectType: string,
): boolean {
  return edges.some(
    (e) => e.source === source && e.target === target && e.data?.objectType === objectType,
  );
}

// ---------------------------------------------------------------------------
// Example model — order/item fulfilment OC-DFG
// ---------------------------------------------------------------------------

export function exampleModel(): OcdfgModelFile {
  const activity = (id: string, label: string, x: number, y: number): OcdfgActivity => ({
    id,
    label,
    position: { x, y },
  });
  const arc = (source: string, target: string, objectType: string): OcdfgArc => ({
    id: `a_${source}_${target}_${objectType}`,
    source,
    target,
    objectType,
  });

  // Two horizontal lanes: Order (top), Item (bottom); shared activities sit
  // between them.
  const ORDER_Y = 0;
  const MID_Y = 170;
  const ITEM_Y = 340;

  return {
    format: OCDFG_FORMAT,
    version: 1,
    name: 'Order fulfilment (OC-DFG)',
    objectTypes: [
      { name: 'Order', color: '#10B981' },
      { name: 'Item', color: '#2563EB' },
    ],
    activities: [
      activity('place', 'place order', 300, MID_Y),
      activity('pay', 'pay order', 640, ORDER_Y),
      activity('pick', 'pick item', 640, ITEM_Y),
      activity('pack', 'pack items', 980, ITEM_Y),
      activity('complete', 'complete order', 1320, MID_Y),
    ],
    starts: [
      { id: 'start_Order', objectType: 'Order', position: { x: 40, y: ORDER_Y + 70 } },
      { id: 'start_Item', objectType: 'Item', position: { x: 40, y: ITEM_Y - 70 } },
    ],
    ends: [
      { id: 'end_Order', objectType: 'Order', position: { x: 1620, y: ORDER_Y + 70 } },
      { id: 'end_Item', objectType: 'Item', position: { x: 1620, y: ITEM_Y - 70 } },
    ],
    arcs: [
      // Order lane.
      arc('start_Order', 'place', 'Order'),
      arc('place', 'pay', 'Order'),
      arc('pay', 'complete', 'Order'),
      arc('complete', 'end_Order', 'Order'),
      // Item lane — picking repeats per item (self-loop).
      arc('start_Item', 'place', 'Item'),
      arc('place', 'pick', 'Item'),
      arc('pick', 'pick', 'Item'),
      arc('pick', 'pack', 'Item'),
      arc('pack', 'complete', 'Item'),
      arc('complete', 'end_Item', 'Item'),
    ],
  };
}
