/** What the Process Area canvas needs to be editable in place. */
import type { DropTarget } from './composition';

export type ProcessAreaCanvasEditing = {
  selectedAreaId: string | null;
  /** Areas with a blocking problem (e.g. a duplicate name), outlined in red. */
  invalidAreaIds: Set<string>;
  /** Object types in no process area, offered in a tray on the canvas. */
  unassigned: string[];
  /** Number of levels (empty ones included). */
  levelCount: number;
  onSelectArea: (areaId: string | null) => void;
  onMoveObjectType: (objectType: string, target: DropTarget) => void;
  onMoveArea: (areaId: string, target: DropTarget) => void;
  onInsertLevel: (index: number) => void;
  onRemoveLevel: (index: number) => void;
};

export type CanvasDragItem = { kind: 'type'; objectType: string } | { kind: 'area'; areaId: string };

export function dropTargetKey(target: DropTarget): string {
  if (target.kind === 'area') return `area:${target.areaId}`;
  if (target.kind === 'newArea') return `level:${target.levelIndex}`;
  return 'unassigned';
}
