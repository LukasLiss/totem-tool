import { assignTypeColors } from '@/editors/shared/colors';
import {
  TOTEM_FORMAT,
  type TotemModelFile,
  type XY,
} from '@/editors/shared/model-types';

import {
  freshId,
  type TotemRelationEdgeType,
  type TotemTypeNodeType,
} from './types';

/**
 * Serialize the canvas state into the shared TOTeM JSON file format.
 * This object doubles as the undo/redo snapshot.
 */
export function buildModelFile(
  name: string,
  nodes: TotemTypeNodeType[],
  edges: TotemRelationEdgeType[],
): TotemModelFile {
  const nameById = new Map(nodes.map((node) => [node.id, node.data.name]));
  return {
    format: TOTEM_FORMAT,
    version: 1,
    name,
    objectTypes: nodes.map((node) => ({
      name: node.data.name,
      color: node.data.color,
      position: { x: node.position.x, y: node.position.y },
    })),
    relations: edges.flatMap((edge) => {
      const source = nameById.get(edge.source);
      const target = nameById.get(edge.target);
      if (!source || !target || !edge.data) return [];
      return [
        {
          id: edge.id,
          source,
          target,
          temporal: edge.data.temporal,
          sourceToTarget: { ...edge.data.sourceToTarget },
          targetToSource: { ...edge.data.targetToSource },
        },
      ];
    }),
  };
}

/** Simple circle placement for object types without a stored position. */
function fallbackPosition(index: number, total: number): XY {
  const radius = Math.max(200, total * 46);
  const angle = (2 * Math.PI * index) / Math.max(total, 1) - Math.PI / 2;
  return {
    x: Math.round(radius * Math.cos(angle)),
    y: Math.round(radius * Math.sin(angle)),
  };
}

/**
 * Convert a (validated) TOTeM model file into React Flow nodes and edges.
 * Same code path for import, example loading and undo/redo restore.
 */
export function modelToFlow(model: TotemModelFile): {
  nodes: TotemTypeNodeType[];
  edges: TotemRelationEdgeType[];
} {
  const colors = assignTypeColors(model.objectTypes);
  const idByName = new Map<string, string>();

  const nodes: TotemTypeNodeType[] = model.objectTypes.map((type, index) => {
    const id = freshId('type');
    idByName.set(type.name, id);
    return {
      id,
      type: 'totemType',
      position: type.position ?? fallbackPosition(index, model.objectTypes.length),
      data: { name: type.name, color: colors[type.name] },
    };
  });

  const edges: TotemRelationEdgeType[] = model.relations.flatMap((relation) => {
    const source = idByName.get(relation.source);
    const target = idByName.get(relation.target);
    if (!source || !target) return [];
    return [
      {
        // Always mint a fresh id: ids stored in files can collide with ids the
        // module-level freshId() counter hands out after a page reload, and
        // nothing references relation ids across import/undo.
        id: freshId('relation'),
        type: 'totemRelation' as const,
        source,
        target,
        data: {
          temporal: relation.temporal,
          sourceToTarget: { ...relation.sourceToTarget },
          targetToSource: { ...relation.targetToSource },
        },
      },
    ];
  });

  return { nodes, edges };
}

/** Empty model with the given name (used by "New"). */
export function emptyModelFile(name: string): TotemModelFile {
  return { format: TOTEM_FORMAT, version: 1, name, objectTypes: [], relations: [] };
}
