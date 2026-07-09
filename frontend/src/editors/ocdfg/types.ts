import { createContext } from 'react';
import type { Edge, Node } from '@xyflow/react';

import type { XY } from '@/editors/shared/model-types';

/**
 * React Flow node/edge shapes used by the OC-DFG editor.
 *
 * The `color` / `typeDotColors` fields are DERIVED presentation data — they
 * are recomputed from the object type list and the arcs on every render (see
 * the display memos in OcdfgEditor) so the base state never goes stale.
 */

export type OcdfgObjectType = {
  name: string;
  /** Always resolved to a concrete hex color inside the editor. */
  color: string;
};

export type ActivityNodeData = {
  /** Activity name shown in the node. */
  label: string;
  /** Derived: colors of the object types of incident arcs. */
  typeDotColors: string[];
};

export type ControlNodeData = {
  kind: 'start' | 'end';
  objectType: string;
  /** Derived: color of the object type. */
  color: string;
};

export type ActivityFlowNode = Node<ActivityNodeData, 'activity'>;
export type ControlFlowNode = Node<ControlNodeData, 'control'>;
export type OcdfgFlowNode = ActivityFlowNode | ControlFlowNode;

export type ArcEdgeData = {
  /** Object type of the directly-follows relation. */
  objectType: string;
  /** Derived: color of the object type. */
  color: string;
  /** Bend points the arc is routed through (layout only, in flow coordinates). */
  waypoints?: XY[];
  /**
   * Derived routing hints for arcs without user bend points, so parallel
   * arcs between the same nodes (or several self-loops on one node) never
   * overlap: perpendicular midpoint offset resp. self-loop stacking index.
   */
  parallelOffset?: number;
  loopIndex?: number;
};

export type ArcFlowEdge = Edge<ArcEdgeData, 'arc'>;

/**
 * Editor callbacks the custom arc edge uses for its bend-point interaction
 * (drag to move, double-click to remove). Provided by OcdfgEditor so the
 * state changes flow through the editor's undo history.
 */
export type OcdfgEdgeApi = {
  beginWaypointDrag: () => void;
  moveWaypoint: (edgeId: string, index: number, position: XY) => void;
  endWaypointDrag: () => void;
  removeWaypoint: (edgeId: string, index: number) => void;
};

export const OcdfgEdgeApiContext = createContext<OcdfgEdgeApi | null>(null);

/**
 * Color of the active object type — the type a new activity-to-activity arc
 * would get. The connection-line preview uses it so the drag already shows
 * the color of the arc it creates.
 */
export const ActiveTypeColorContext = createContext<string>('#64748B');

export const isControlNode = (node: OcdfgFlowNode): node is ControlFlowNode =>
  node.type === 'control';

/** Layout sizes (also used as ELK node sizes). */
export const CONTROL_SIZE = 48;
export const ACTIVITY_WIDTH = 130;
export const ACTIVITY_HEIGHT = 48;

export const FALLBACK_TYPE_COLOR = '#64748B';
