/**
 * Editing state of a process-area composition: the draft, undo/redo, and
 * the edit operations of `composition.ts` bound to it. The Process Area
 * component owns one while its canvas is in edit mode; the canvas, the
 * header toolbar and the docked inspector all act through it.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import { useUndoRedo } from '@/editors/shared/useUndoRedo';

import {
  cloneComposition,
  compositionProblems,
  insertLevel,
  moveArea,
  moveObjectType,
  removeLevel,
  renameArea,
  renameComposition,
  resetAllActivities,
  resetAreaActivities,
  setAreaActivities,
  type DropTarget,
  type ProcessAreaComposition,
} from './composition';

export function useCompositionEditor(objectTypeToActivities: Record<string, string[]>) {
  const [draft, setDraft] = useState<ProcessAreaComposition | null>(null);
  const history = useUndoRedo<ProcessAreaComposition>(200);

  const start = useCallback(
    (composition: ProcessAreaComposition) => {
      setDraft(cloneComposition(composition));
      history.reset();
    },
    [history],
  );
  const stop = useCallback(() => {
    setDraft(null);
    history.reset();
  }, [history]);

  /** Apply a discrete edit, recording the previous state for undo. */
  const commit = useCallback(
    (update: (current: ProcessAreaComposition) => ProcessAreaComposition) => {
      setDraft((current) => {
        if (!current) return current;
        const next = update(current);
        if (next !== current) history.record(current);
        return next;
      });
    },
    [history],
  );

  // Typing records one undo step per focus, and only once something changed.
  const textEditStartRef = useRef<ProcessAreaComposition | null>(null);
  const beginTextEdit = useCallback(() => {
    textEditStartRef.current = draft;
  }, [draft]);
  const editText = useCallback(
    (update: (current: ProcessAreaComposition) => ProcessAreaComposition) => {
      if (textEditStartRef.current) {
        history.record(textEditStartRef.current);
        textEditStartRef.current = null;
      }
      setDraft((current) => (current ? update(current) : current));
    },
    [history],
  );

  const undo = useCallback(() => {
    if (!draft) return;
    const previous = history.undo(draft);
    if (previous) setDraft(previous);
  }, [history, draft]);
  const redo = useCallback(() => {
    if (!draft) return;
    const next = history.redo(draft);
    if (next) setDraft(next);
  }, [history, draft]);

  const problems = useMemo(() => (draft ? compositionProblems(draft) : []), [draft]);

  return {
    draft,
    editing: draft !== null,
    start,
    stop,
    replace: (next: ProcessAreaComposition) => commit(() => cloneComposition(next)),
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    problems,
    errors: problems.filter((p) => p.severity === 'error'),
    beginTextEdit,
    moveObjectType: (objectType: string, target: DropTarget) =>
      commit((c) => moveObjectType(c, objectType, target, objectTypeToActivities)),
    moveArea: (areaId: string, target: DropTarget) => commit((c) => moveArea(c, areaId, target)),
    insertLevel: (index: number) => commit((c) => insertLevel(c, index)),
    removeLevel: (index: number) => commit((c) => removeLevel(c, index)),
    setActivities: (areaId: string, activities: string[]) =>
      commit((c) => setAreaActivities(c, areaId, activities)),
    resetActivities: (areaId: string) =>
      commit((c) => resetAreaActivities(c, areaId, objectTypeToActivities)),
    resetAllActivities: () => commit((c) => resetAllActivities(c, objectTypeToActivities)),
    renameComposition: (name: string) => editText((c) => renameComposition(c, name)),
    renameArea: (areaId: string, name: string) => editText((c) => renameArea(c, areaId, name)),
  };
}

export type CompositionEditor = ReturnType<typeof useCompositionEditor>;
