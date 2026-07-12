import { activityKind } from '@/editors/occn/model';
import {
  arcId,
  type BindingsMap,
  type OccnEdge as EditorOccnEdge,
  type OccnNode as EditorOccnNode,
} from '@/editors/occn/types';
import type { OccnMarker as EditorOccnMarker } from '@/editors/shared/model-types';

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

export type OccnLayoutDirection = 'LR' | 'TB';

/**
 * Real logs can yield thousands of distinct marker groups per activity
 * (order-management: >1000 input groups on "pay order"), which makes an
 * uncapped render unusable. Show the most supported groups and summarize the
 * rest in "+N" overflow chips.
 */
export const DEFAULT_MAX_MARKER_GROUPS_PER_SIDE = 12;

// --- Adapter: serialized OCCN → the editor's render model -------------------
//
// The visualizer draws with the OCCN editor's primitives (editors/occn/):
// OccnNode / OccnEdge components, MarkerOverlay markers-on-arcs. This adapter
// maps the backend payload into the shapes those primitives consume.

/** Key for `groupSupport`, matching MarkerOverlay's GroupRef fields. */
export const groupSupportKey = (
  activity: string,
  side: 'img' | 'omg',
  groupIndex: number,
) => `${activity}|${side}|${groupIndex}`;

export interface OccnEditorGraph {
  nodes: EditorOccnNode[];
  edges: EditorOccnEdge[];
  /** Marker groups per activity, capped per side; editor tuple shape. */
  bindings: BindingsMap;
  /** support_count of each kept group, keyed by groupSupportKey(...). */
  groupSupport: Map<string, number | null>;
  /** Groups dropped by the per-side cap, per activity (only entries > 0). */
  overflow: Record<string, { img: number; omg: number }>;
}

/** Keep the most supported groups; groups with unknown support keep order. */
function capGroups(
  groups: OccnMarkerGroup[],
  maxGroupsPerSide: number,
): { shown: OccnMarkerGroup[]; overflow: number } {
  if (groups.length <= maxGroupsPerSide) return { shown: groups, overflow: 0 };
  const shown = groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (b.g.support_count ?? -1) - (a.g.support_count ?? -1) || a.i - b.i)
    .slice(0, maxGroupsPerSide)
    .sort((a, b) => a.i - b.i)
    .map(({ g }) => g);
  return { shown, overflow: groups.length - maxGroupsPerSide };
}

/**
 * Backend marker → editor tuple. `max_count: null` (∞) becomes the editor's
 * -1 sentinel; string marker keys are renumbered 1,2,3… per group (0 = no
 * key), which preserves the key-badge semantics (badges appear when ≥2
 * markers of a group share a non-zero key).
 */
function toEditorGroup(group: OccnMarkerGroup): EditorOccnMarker[] {
  const keyNumbers = new Map<string, number>();
  return group.markers.map((m): EditorOccnMarker => {
    let keyNum = 0;
    if (m.marker_key !== '') {
      keyNum = keyNumbers.get(m.marker_key) ?? keyNumbers.size + 1;
      keyNumbers.set(m.marker_key, keyNum);
    }
    return [m.related_activity, m.object_type, [m.min_count, m.max_count ?? -1], keyNum];
  });
}

export function occnNetToEditorGraph(
  net: OccnNet,
  options?: { maxMarkerGroupsPerSide?: number },
): OccnEditorGraph {
  const maxGroupsPerSide =
    options?.maxMarkerGroupsPerSide ?? DEFAULT_MAX_MARKER_GROUPS_PER_SIDE;
  const typeNames = new Set(net.object_types);

  const nodes: EditorOccnNode[] = net.activities.map((activity) => {
    const { kind, objectType } = activityKind(activity.id, typeNames);
    return {
      id: activity.id,
      type: 'occn',
      position: { x: 0, y: 0 },
      data: {
        label: activity.id,
        kind,
        objectType,
        ...(kind === 'activity' ? { count: activity.count } : {}),
      },
    };
  });

  // One arc per (source, target, object_type); dedupe defensively since a
  // duplicate id would break the parallel-offset and marker-arc lookups.
  // Note: at higher thresholds a kept group's marker may reference an arc
  // that was pruned from net.edges — computeMarkerLayout silently skips such
  // markers (same behavior as the editor with bindingless arcs removed).
  const edges: EditorOccnEdge[] = [];
  const seenArcs = new Set<string>();
  for (const e of net.edges) {
    const id = arcId(e.source, e.target, e.object_type);
    if (seenArcs.has(id)) continue;
    seenArcs.add(id);
    edges.push({
      id,
      source: e.source,
      target: e.target,
      type: 'occnArc',
      data: { objectType: e.object_type, dependenceMeasure: e.dependence_measure },
    });
  }

  const bindings: BindingsMap = Object.create(null);
  const groupSupport = new Map<string, number | null>();
  const overflow: Record<string, { img: number; omg: number }> = {};

  for (const activity of net.activities) {
    const a = activity.id;
    const input = capGroups(net.input_marker_groups[a] ?? [], maxGroupsPerSide);
    const output = capGroups(net.output_marker_groups[a] ?? [], maxGroupsPerSide);
    bindings[a] = {
      img: input.shown.map(toEditorGroup),
      omg: output.shown.map(toEditorGroup),
    };
    input.shown.forEach((g, i) => groupSupport.set(groupSupportKey(a, 'img', i), g.support_count));
    output.shown.forEach((g, i) => groupSupport.set(groupSupportKey(a, 'omg', i), g.support_count));
    if (input.overflow > 0 || output.overflow > 0) {
      overflow[a] = { img: input.overflow, omg: output.overflow };
    }
  }

  return { nodes, edges, bindings, groupSupport, overflow };
}
