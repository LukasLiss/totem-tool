import { createContext } from 'react';
import type { Edge, Node } from '@xyflow/react';

import type { OccnMarkerGroup } from '@/editors/shared/model-types';

/** Node kinds: visible activities plus the START/END pseudo activities per object type. */
export type OccnNodeKind = 'activity' | 'start' | 'end';

export type OccnNodeData = {
  label: string;
  kind: OccnNodeKind;
  /** Object type of START/END pseudo activities. */
  objectType?: string;
};

export type OccnNode = Node<OccnNodeData, 'occn'>;

export type OccnEdgeData = { objectType: string };

export type OccnEdge = Edge<OccnEdgeData, 'occnArc'>;

export type BindingSide = 'img' | 'omg';

/** Normalised bindings (img/omg always present) used for the editor state. */
export type ActivityBindings = { img: OccnMarkerGroup[]; omg: OccnMarkerGroup[] };
export type BindingsMap = Record<string, ActivityBindings>;

/** Reference to one marker group of an activity. */
export type GroupRef = { activity: string; side: BindingSide; groupIndex: number };

export type Selection =
  | { kind: 'activity'; id: string }
  | { kind: 'arc'; id: string }
  | null;

/** Stable id for the dependency arc triple (source, target, objectType). */
export const arcId = (source: string, target: string, objectType: string) =>
  JSON.stringify([source, target, objectType]);

export const parseArcId = (id: string): [string, string, string] =>
  JSON.parse(id) as [string, string, string];

export const groupRefEquals = (a: GroupRef | null, b: GroupRef | null) =>
  !!a && !!b && a.activity === b.activity && a.side === b.side && a.groupIndex === b.groupIndex;

/** Default node sizes (also used for ELK and as measurement fallbacks). */
export const ACTIVITY_WIDTH = 140;
export const ACTIVITY_HEIGHT = 56;
export const PSEUDO_WIDTH = 56;
export const PSEUDO_HEIGHT = 74;

export const nodeFallbackSize = (kind: OccnNodeKind) =>
  kind === 'activity'
    ? { width: ACTIVITY_WIDTH, height: ACTIVITY_HEIGHT }
    : { width: PSEUDO_WIDTH, height: PSEUDO_HEIGHT };

/**
 * Render context shared by custom nodes and edges: object type colors, the
 * object types incident to each activity (for the striped fills) and the
 * perpendicular offset per arc so parallel arcs of a multigraph fan out.
 */
export type OccnRenderContextValue = {
  typeColors: Record<string, string>;
  incidentTypes: Record<string, string[]>;
  parallelOffset: Record<string, number>;
};

export const OccnRenderContext = createContext<OccnRenderContextValue>({
  typeColors: {},
  incidentTypes: {},
  parallelOffset: {},
});
