import { useCallback, useEffect, useRef, useState } from "react";
import { getComponentFilters, saveComponentFilter } from "@/api/componentFilterApi";

const DEBOUNCE_MS = 800;

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

  // Load persisted filter on mount (or when project changes)
  useEffect(() => {
    if (!projectId) return;
    getComponentFilters(projectId)
      .then((all) => {
        if (all[componentKey]) setParams(all[componentKey]);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, componentKey]);

  const setParamsAndSave = useCallback(
    (next: Record<string, string>) => {
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
