import type { Edge, Node } from '@xyflow/react';

/**
 * React Flow node/edge shapes used by the OCPN editor.
 *
 * The `color` / `typeDotColors` fields are DERIVED presentation data — they
 * are recomputed from the object type list and the arcs on every render (see
 * the display memos in OcpnEditor) so the base state never goes stale.
 */

export type OcpnObjectType = {
  name: string;
  /** Always resolved to a concrete hex color inside the editor. */
  color: string;
};

export type PlaceNodeData = {
  objectType: string;
  /** Derived: color of the object type. */
  color: string;
  initial: boolean;
  final: boolean;
};

export type TransitionNodeData = {
  /** Activity label. Kept even while silent (hidden/ignored then). */
  label: string;
  silent: boolean;
  /** Derived: colors of the object types of connected places. */
  typeDotColors: string[];
};

export type PlaceFlowNode = Node<PlaceNodeData, 'place'>;
export type TransitionFlowNode = Node<TransitionNodeData, 'transition'>;
export type OcpnFlowNode = PlaceFlowNode | TransitionFlowNode;

export type ArcEdgeData = {
  variable: boolean;
  /** Derived: color of the object type of the place endpoint. */
  color: string;
  /** Derived: object type of the place endpoint. */
  objectType: string;
};

export type ArcFlowEdge = Edge<ArcEdgeData, 'arc'>;

export const isPlaceNode = (node: OcpnFlowNode): node is PlaceFlowNode =>
  node.type === 'place';

export const isTransitionNode = (node: OcpnFlowNode): node is TransitionFlowNode =>
  node.type === 'transition';

/** Layout sizes (also used as ELK node sizes). */
export const PLACE_SIZE = 48;
export const TRANSITION_WIDTH = 130;
export const TRANSITION_HEIGHT = 48;
export const SILENT_WIDTH = 56;
export const SILENT_HEIGHT = 36;

export const FALLBACK_TYPE_COLOR = '#64748B';
