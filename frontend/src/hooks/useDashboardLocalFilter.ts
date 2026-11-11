import { useCallback, useRef, useState } from "react";
import type { GridStackNode } from "gridstack";
import { patchDashboardComponentLocalFilter } from "@/api/componentFilterApi";

const DEBOUNCE_MS = 600;

/**
 * Local filter state for a dashboard widget.
 * Keeps the in-memory gridstack node in sync via `onUpdate` and
 * auto-PATCHes the backend after a short debounce so the selection
 * survives a page reload without a manual dashboard save.
 */
export function useDashboardLocalFilter(
  initialParams: Record<string, string> | null | undefined,
  dashboardId: number,
  componentId: number,
  onUpdate?: (updates: Partial<GridStackNode>) => void,
) {
  const [localFilterParams, setLocalFilterParams] = useState<Record<string, string>>(
    initialParams ?? {}
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLocalFilterChange = useCallback(
    (params: Record<string, string>) => {
      setLocalFilterParams(params);
      const persisted = Object.keys(params).length > 0 ? params : null;
      onUpdate?.({ local_filter_params: persisted });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        patchDashboardComponentLocalFilter(dashboardId, componentId, persisted).catch(() => {});
      }, DEBOUNCE_MS);
    },
    [dashboardId, componentId, onUpdate],
  );

  return [localFilterParams, handleLocalFilterChange] as const;
}
