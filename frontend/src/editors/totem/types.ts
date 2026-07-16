import type { Edge, Node } from '@xyflow/react';

import type {
  TemporalRelation,
  TotemDirectionAnnotation,
} from '@/editors/shared/model-types';

/** Data carried by an object type node on the canvas. */
export type TotemTypeNodeData = {
  name: string;
  color: string;
};

/** Data carried by a relation edge (temporal + cardinality annotations). */
export type TotemRelationEdgeData = {
  /** Temporal relation, read source → target. */
  temporal: TemporalRelation;
  sourceToTarget: TotemDirectionAnnotation;
  targetToSource: TotemDirectionAnnotation;
};

export type TotemTypeNodeType = Node<TotemTypeNodeData, 'totemType'>;
export type TotemRelationEdgeType = Edge<TotemRelationEdgeData, 'totemRelation'>;

let idCounter = 0;

/** Session-unique element id. */
export function freshId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
