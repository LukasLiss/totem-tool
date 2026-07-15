import { useCallback, useRef, useState } from 'react';

/**
 * Snapshot based undo/redo used by the model editors.
 *
 * Usage contract: call `record(snapshot)` with the state as it is BEFORE a
 * discrete mutation (add/remove element, connect, property change, drag end).
 * `undo(current)` / `redo(current)` return the snapshot to restore, or null.
 * Do not call `record` for transient updates (e.g. every drag move).
 */
export function useUndoRedo<T>(capacity = 100) {
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  // Only used to trigger re-renders so canUndo/canRedo stay accurate.
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const record = useCallback((snapshot: T) => {
    pastRef.current.push(snapshot);
    if (pastRef.current.length > capacity) pastRef.current.shift();
    futureRef.current = [];
    bump();
  }, [capacity]);

  const undo = useCallback((current: T): T | null => {
    const previous = pastRef.current.pop();
    if (previous === undefined) return null;
    futureRef.current.push(current);
    bump();
    return previous;
  }, []);

  const redo = useCallback((current: T): T | null => {
    const next = futureRef.current.pop();
    if (next === undefined) return null;
    pastRef.current.push(current);
    bump();
    return next;
  }, []);

  const reset = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    bump();
  }, []);

  return {
    record,
    undo,
    redo,
    reset,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  };
}
