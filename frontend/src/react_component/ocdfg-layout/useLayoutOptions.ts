/**
 * The layout options of one OC-DFG view, loaded from and saved to wherever
 * the view stores them (a dashboard widget or the project).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { getProjectViewSetting, putProjectViewSetting } from '@/api/projectApi';
import { fromStoredLayout, toStoredLayout, type StoredLayout } from './preferences';
import type { LayoutOptions } from './types';

const SAVE_DELAY_MS = 600;

export type SaveLayout = (entry: StoredLayout | null) => void | Promise<void>;

/**
 * `stored` is the stored entry as read (undefined while it loads); `save`
 * persists a new entry (null = the defaults), called debounced while the
 * user drags sliders. Changes made before a slow load finishes win over it.
 * `scope` identifies where the options are stored: a new scope (another
 * project, say) loads its own entry again.
 */
export function useLayoutOptions(defaults: LayoutOptions, stored: unknown, save?: SaveLayout, scope = '') {
  const [options, setOptionsState] = useState<LayoutOptions>(() => fromStoredLayout(stored, defaults));
  const optionsRef = useRef(options);
  const edited = useRef(false);
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const saveRef = useRef(save);
  saveRef.current = save;

  const storedKey = JSON.stringify(stored ?? null);
  const defaultsKey = JSON.stringify(defaults);
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current !== scope) {
      lastScope.current = scope;
      edited.current = false;
    }
    if (edited.current) return;
    const next = fromStoredLayout(stored, defaults);
    optionsRef.current = next;
    setOptionsState(next);
    // `stored` and `defaults` are compared by value through their keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey, defaultsKey, scope]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ entry: StoredLayout | null } | null>(null);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p && saveRef.current) void saveRef.current(p.entry);
  }, []);
  useEffect(() => flush, [flush]);

  const commit = useCallback(
    (next: LayoutOptions, entry: StoredLayout | null) => {
      edited.current = true;
      optionsRef.current = next;
      setOptionsState(next);
      if (!saveRef.current) return;
      pending.current = { entry };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  /** Change some options. */
  const update = useCallback(
    (patch: Partial<LayoutOptions>) => {
      const next = { ...optionsRef.current, ...patch };
      commit(next, toStoredLayout(next, defaultsRef.current));
    },
    [commit],
  );

  /** Back to the view's defaults; the stored entry is removed. */
  const reset = useCallback(() => commit(defaultsRef.current, null), [commit]);

  return { options, update, reset };
}

/** Stored layout of a project-level view, e.g. the analysis OC-DFG. */
export function useProjectLayoutStorage(projectId: number | undefined, key: string) {
  const [stored, setStored] = useState<unknown>(undefined);
  useEffect(() => {
    if (!projectId) {
      setStored(null);
      return;
    }
    let cancelled = false;
    setStored(undefined);
    getProjectViewSetting(projectId, key)
      .then((value) => !cancelled && setStored(value))
      .catch(() => !cancelled && setStored(null));
    return () => {
      cancelled = true;
    };
  }, [projectId, key]);

  const save = useCallback<SaveLayout>(
    async (entry) => {
      if (!projectId) return;
      try {
        await putProjectViewSetting(projectId, key, entry);
      } catch {
        toast.error('The OC-DFG layout could not be saved');
      }
    },
    [projectId, key],
  );

  return { stored, save, scope: `project:${projectId ?? ''}:${key}` };
}
