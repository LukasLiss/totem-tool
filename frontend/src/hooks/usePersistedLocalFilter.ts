import { useCallback, useEffect, useRef, useState } from "react";
import { getComponentFilters, saveComponentFilter } from "@/api/componentFilterApi";

const DEBOUNCE_MS = 800;

type FilterMap = Record<string, Record<string, string>>;

// In-flight loads per project, so the many hooks a page mounts at once (one
// per component key) share a single request. Dropped once settled, so a
// later mount reads fresh data.
const inFlight = new Map<number, Promise<FilterMap>>();

function loadComponentFilters(projectId: number): Promise<FilterMap> {
  let pending = inFlight.get(projectId);
  if (!pending) {
    pending = getComponentFilters(projectId).finally(() => inFlight.delete(projectId));
    inFlight.set(projectId, pending);
  }
  return pending;
}

/**
 * Loads and persists local filter params.
 *
 * @param projectId - the project to scope the filter to (null/undefined → no-op)
 * @param componentKey - stable identifier for this component type (e.g. "ocdfg")
 */
export function usePersistedLocalFilter(
  projectId: number | null | undefined,
  componentKey: string
): [Record<string, string>, (params: Record<string, string>) => void] {
  const [params, setParams] = useState<Record<string, string>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set once the user changes the filter for the current project, so a load
  // that resolves afterwards does not overwrite their choice.
  const changedRef = useRef(false);

  // Load the persisted filter on mount and whenever the project changes;
  // start empty so another project's filter never carries over.
  useEffect(() => {
    setParams({});
    changedRef.current = false;
    // A save still pending for the previous project goes through (its timer
    // holds that project id); forget it so a change here does not cancel it.
    saveTimerRef.current = null;
    if (!projectId) return;
    let cancelled = false;
    loadComponentFilters(projectId)
      .then((all) => {
        if (cancelled || changedRef.current) return;
        if (all[componentKey]) setParams(all[componentKey]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, componentKey]);

  const setParamsAndSave = useCallback(
    (next: Record<string, string>) => {
      changedRef.current = true;
      setParams(next);
      if (!projectId) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveComponentFilter(projectId, componentKey, next).catch(() => {});
      }, DEBOUNCE_MS);
    },
    [projectId, componentKey]
  );

  return [params, setParamsAndSave];
}
