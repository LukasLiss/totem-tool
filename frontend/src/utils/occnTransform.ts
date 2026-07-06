import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { backgroundForTypes, textColorForBackground } from './objectColors';

// --- API response types (authoritative shape: totem_lib/src/totem_lib/occn/serialize.py) ---

export interface OccnMarker {
  related_activity: string;
  object_type: string;
  min_count: number;
  max_count: number | null; // null = unbounded (∞)
  marker_key: string;
}

export interface OccnMarkerGroup {
  support_count: number | null;
  markers: OccnMarker[];
}

export interface OccnActivity {
  id: string;
  count: number;
}

export interface OccnDependencyEdge {
  source: string;
  target: string;
  object_type: string;
  dependence_measure: number | null;
}

export interface OccnNet {
  object_types: string[];
  relative_occurrence_threshold: number;
  activities: OccnActivity[];
  edges: OccnDependencyEdge[];
  input_marker_groups: Record<string, OccnMarkerGroup[]>;
  output_marker_groups: Record<string, OccnMarkerGroup[]>;
}

// --- React Flow node data types ---

export type OccnLayoutDirection = 'LR' | 'TB';

export type OccnActivityNodeData = {
  label: string;
  count: number;
  types: string[];
  background: string;
  textColor: string;
  direction: OccnLayoutDirection;
};

export type OccnTerminalNodeData = {
  label: string;
  terminal: 'start' | 'end';
  objectType: string;
  fillColor: string;
  direction: OccnLayoutDirection;
};

export type OccnMarkerRow = {
  objectType: string;
  color: string;
  relatedActivity: string;
  markerKey: string;
  cardinality: string;
  shape: 'circle' | 'square';
  handleId: string;
};

export type OccnMarkerGroupNodeData = {
  side: 'input' | 'output';
  activity: string;
  supportCount: number | null;
  markers: OccnMarkerRow[];
  /** When set, this node is a "+N more groups" indicator, not a real group. */
  overflowCount?: number;
};

export type OccnEdgeData = {
  objectType: string;
  color: string;
  dependenceMeasure: number | null;
  selfLoop: boolean;
  parallelIndex: number;
  parallelCount: number;
};

// --- Geometry constants (shared with the node components and the layouter) ---

export const ACTIVITY_W = 150;
export const ACTIVITY_H = 70;
export const MARKER_DOT = 18;
export const MARKER_ROW_H = 24;
export const MARKER_GROUP_PAD_V = 8;
export const MARKER_GROUP_W = 96;
export const MARKER_GROUP_GAP = 12;
export const GROUP_PAD = 14;
export const OVERFLOW_NODE_H = 26;

/**
 * Real logs can yield thousands of distinct marker groups per activity
 * (order-management: >1000 input groups on "pay order"), which makes an
 * uncapped render unusable. Show the most supported groups and summarize the
 * rest in a "+N more" indicator.
 */
export const DEFAULT_MAX_MARKER_GROUPS_PER_SIDE = 12;

// Handle ids: edges silently vanish on a mismatch, so both the transform and
// the node components import these. Dependency handles move with the layout
// direction (LR: left/right, TB: top/bottom); binding handles always stay
// left/right because the marker columns inside a group are always horizontal.
export const HANDLE_DEPENDENCY_IN = 'dependency_in';
export const HANDLE_DEPENDENCY_OUT = 'dependency_out';
export const HANDLE_BINDING_IN = 'binding_in';
export const HANDLE_BINDING_OUT = 'binding_out';
export const markerHandleId = (index: number) => `m${index}`;

export function markerGroupHeight(group: OccnMarkerGroup): number {
  return MARKER_GROUP_PAD_V * 2 + group.markers.length * MARKER_ROW_H;
}

export function markerRowCenter(index: number): number {
  return MARKER_GROUP_PAD_V + index * MARKER_ROW_H + MARKER_ROW_H / 2;
}

export function formatCardinality(min: number, max: number | null): string {
  if (max !== null && min === max) return `${min}`;
  return `${min}..${max ?? '∞'}`;
}

export const isStartActivity = (id: string) => id.startsWith('START_');
export const isEndActivity = (id: string) => id.startsWith('END_');
export const isTerminalActivity = (id: string) => isStartActivity(id) || isEndActivity(id);

export const groupNodeId = (activity: string) => `grp:${activity}`;
export const activityNodeId = (activity: string) => `act:${activity}`;

export interface OccnFlowResult {
  nodes: Node[];
  edges: Edge[];
  groupSizes: Record<string, { width: number; height: number }>;
}

/**
 * Pure transform: serialized OCCN + object-type color map → React Flow
 * nodes/edges. Group positions are left at (0,0); the layouter fills them in
 * (issue #155 swaps the layouter without touching this transform).
 *
 * Node structure per activity (ported from OCCN-Miner's Flow2.tsx): a `group`
 * parent containing the activity box in the middle, input marker groups on
 * the left and output marker groups on the right. v12 requires parents to
 * appear before their children in the node array.
 */
export interface OccnToFlowOptions {
  maxMarkerGroupsPerSide?: number;
  /** Where dependency handles sit on activity nodes; must match the layouter's direction. */
  direction?: OccnLayoutDirection;
}

export function occnToFlow(
  net: OccnNet,
  colors: Record<string, string>,
  options?: OccnToFlowOptions,
): OccnFlowResult {
  const maxGroupsPerSide = options?.maxMarkerGroupsPerSide ?? DEFAULT_MAX_MARKER_GROUPS_PER_SIDE;
  const direction = options?.direction ?? 'LR';
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const groupSizes: Record<string, { width: number; height: number }> = {};

  // Object types incident on each activity (edges + markers) drive its background.
  const activityTypes = new Map<string, Set<string>>();
  const addType = (activity: string, type: string) => {
    if (!activityTypes.has(activity)) activityTypes.set(activity, new Set());
    activityTypes.get(activity)!.add(type);
  };
  net.edges.forEach((e) => {
    addType(e.source, e.object_type);
    addType(e.target, e.object_type);
  });
  const collectMarkerTypes = (groups: Record<string, OccnMarkerGroup[]>) => {
    Object.entries(groups).forEach(([activity, mgs]) =>
      mgs.forEach((mg) => mg.markers.forEach((m) => addType(activity, m.object_type))),
    );
  };
  collectMarkerTypes(net.input_marker_groups);
  collectMarkerTypes(net.output_marker_groups);

  // Keep the most supported groups when a side exceeds the cap; groups with
  // unknown support keep their original (discovery) order.
  const capGroups = (groups: OccnMarkerGroup[]) => {
    if (groups.length <= maxGroupsPerSide) return { shown: groups, overflow: 0 };
    const shown = groups
      .map((g, i) => ({ g, i }))
      .sort((a, b) => (b.g.support_count ?? -1) - (a.g.support_count ?? -1) || a.i - b.i)
      .slice(0, maxGroupsPerSide)
      .sort((a, b) => a.i - b.i)
      .map(({ g }) => g);
    return { shown, overflow: groups.length - maxGroupsPerSide };
  };

  const columnHeight = (groups: OccnMarkerGroup[], overflow: number) => {
    const items =
      groups.map(markerGroupHeight).concat(overflow > 0 ? [OVERFLOW_NODE_H] : []);
    return items.length === 0
      ? 0
      : items.reduce((sum, h) => sum + h, 0) + (items.length - 1) * MARKER_GROUP_GAP;
  };

  const toMarkerRows = (markers: OccnMarker[]): OccnMarkerRow[] =>
    markers.map((m, i) => ({
      objectType: m.object_type,
      color: colors[m.object_type] ?? '#94A3B8',
      relatedActivity: m.related_activity,
      markerKey: m.marker_key,
      cardinality: formatCardinality(m.min_count, m.max_count),
      // Original ObligationNode rule: circle for "exactly one", square for collections.
      shape: m.min_count === 1 && m.max_count === 1 ? 'circle' : 'square',
      handleId: markerHandleId(i),
    }));

  const sortedActivities = [...net.activities].sort((a, b) => a.id.localeCompare(b.id));

  sortedActivities.forEach((activity) => {
    const a = activity.id;
    const { shown: inputGroups, overflow: inputOverflow } = capGroups(net.input_marker_groups[a] ?? []);
    const { shown: outputGroups, overflow: outputOverflow } = capGroups(net.output_marker_groups[a] ?? []);

    const inColH = columnHeight(inputGroups, inputOverflow);
    const outColH = columnHeight(outputGroups, outputOverflow);
    const groupW = MARKER_GROUP_W * 2 + ACTIVITY_W + GROUP_PAD * 4;
    const groupH = Math.max(ACTIVITY_H, inColH, outColH) + GROUP_PAD * 2;

    const grpId = groupNodeId(a);
    groupSizes[grpId] = { width: groupW, height: groupH };

    nodes.push({
      id: grpId,
      type: 'group',
      data: {},
      position: { x: 0, y: 0 },
      style: {
        width: groupW,
        height: groupH,
        background: 'rgba(15, 23, 42, 0.03)',
        border: '1px solid #E2E8F0',
        borderRadius: 10,
      },
    });

    const types = Array.from(activityTypes.get(a) ?? []).sort((x, y) => x.localeCompare(y));
    const actId = activityNodeId(a);
    if (isTerminalActivity(a)) {
      const terminal = isStartActivity(a) ? 'start' : 'end';
      const objectType = terminal === 'start' ? a.slice('START_'.length) : a.slice('END_'.length);
      nodes.push({
        id: actId,
        type: 'occnTerminal',
        parentId: grpId,
        extent: 'parent',
        draggable: false,
        position: { x: MARKER_GROUP_W + GROUP_PAD * 2, y: (groupH - ACTIVITY_H) / 2 },
        data: {
          label: a,
          terminal,
          objectType,
          fillColor: colors[objectType] ?? '#94A3B8',
          direction,
        } satisfies OccnTerminalNodeData,
      });
    } else {
      const background = backgroundForTypes(types, colors);
      nodes.push({
        id: actId,
        type: 'occnActivity',
        parentId: grpId,
        extent: 'parent',
        draggable: false,
        position: { x: MARKER_GROUP_W + GROUP_PAD * 2, y: (groupH - ACTIVITY_H) / 2 },
        data: {
          label: a,
          count: activity.count,
          types,
          background,
          textColor: textColorForBackground(background),
          direction,
        } satisfies OccnActivityNodeData,
      });
    }

    const emitMarkerColumn = (
      groups: OccnMarkerGroup[],
      side: 'input' | 'output',
      colH: number,
      overflow: number,
    ) => {
      const x = side === 'input' ? GROUP_PAD : groupW - GROUP_PAD - MARKER_GROUP_W;
      let y = (groupH - colH) / 2;
      groups.forEach((mg, gi) => {
        const mgId = `${side === 'input' ? 'img' : 'omg'}:${a}:${gi}`;
        nodes.push({
          id: mgId,
          type: 'occnMarkerGroup',
          parentId: grpId,
          extent: 'parent',
          draggable: false,
          position: { x, y },
          data: {
            side,
            activity: a,
            supportCount: mg.support_count,
            markers: toMarkerRows(mg.markers),
          } satisfies OccnMarkerGroupNodeData,
        });

        // One thin binding edge per marker, colored by its object type.
        mg.markers.forEach((m, mi) => {
          const color = colors[m.object_type] ?? '#94A3B8';
          edges.push({
            id: `bind:${mgId}:${mi}`,
            source: side === 'input' ? mgId : actId,
            sourceHandle: side === 'input' ? markerHandleId(mi) : HANDLE_BINDING_OUT,
            target: side === 'input' ? actId : mgId,
            targetHandle: side === 'input' ? HANDLE_BINDING_IN : markerHandleId(mi),
            type: 'straight',
            style: { stroke: color, strokeWidth: 1.2, opacity: 0.7 },
          });
        });

        y += markerGroupHeight(mg) + MARKER_GROUP_GAP;
      });

      if (overflow > 0) {
        nodes.push({
          id: `${side === 'input' ? 'img' : 'omg'}:${a}:overflow`,
          type: 'occnMarkerGroup',
          parentId: grpId,
          extent: 'parent',
          draggable: false,
          position: { x, y },
          data: {
            side,
            activity: a,
            supportCount: null,
            markers: [],
            overflowCount: overflow,
          } satisfies OccnMarkerGroupNodeData,
        });
      }
    };

    emitMarkerColumn(inputGroups, 'input', inColH, inputOverflow);
    emitMarkerColumn(outputGroups, 'output', outColH, outputOverflow);
  });

  // Dependency edges, with parallel-edge bookkeeping so multi-type arcs
  // between the same pair of activities fan out instead of overlapping.
  const pairCounts = new Map<string, number>();
  net.edges.forEach((e) => {
    const key = `${e.source} ${e.target}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  });
  const pairSeen = new Map<string, number>();
  net.edges.forEach((e, i) => {
    const key = `${e.source} ${e.target}`;
    const parallelIndex = pairSeen.get(key) ?? 0;
    pairSeen.set(key, parallelIndex + 1);
    const color = colors[e.object_type] ?? '#94A3B8';
    edges.push({
      id: `dep:${i}:${e.source}->${e.target}:${e.object_type}`,
      source: activityNodeId(e.source),
      sourceHandle: HANDLE_DEPENDENCY_OUT,
      target: activityNodeId(e.target),
      targetHandle: HANDLE_DEPENDENCY_IN,
      type: 'occn',
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, strokeWidth: 2 },
      data: {
        objectType: e.object_type,
        color,
        dependenceMeasure: e.dependence_measure,
        selfLoop: e.source === e.target,
        parallelIndex,
        parallelCount: pairCounts.get(key) ?? 1,
      } satisfies OccnEdgeData,
    });
  });

  return { nodes, edges, groupSizes };
}
