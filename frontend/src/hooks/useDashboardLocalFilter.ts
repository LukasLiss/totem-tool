import { useCallback, useEffect, useRef, useState } from "react";
import type { GridStackNode } from "gridstack";
import { saveDashboardWidgetLocalFilter } from "@/api/componentFilterApi";

const DEBOUNCE_MS = 600;

function sameParams(a: Record<string, string>, b: Record<string, string>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Local filter state for a dashboard widget.
 * Keeps the in-memory gridstack node in sync via `onUpdate` and
 * auto-PATCHes the backend after a short debounce so the selection
 * survives a page reload without a manual dashboard save.
 *
 * The widget is identified by its grid position (like the OC-DFG layout
 * save): component ids change with every dashboard save, so an id held by
 * the page can be stale. The filter is only changed in view mode, where the
 * positions match the stored layout.
 */
export function useDashboardLocalFilter(
  node: GridStackNode,
  dashboardId: number | undefined,
  onUpdate?: (updates: Partial<GridStackNode>) => void,
) {
  const [localFilterParams, setLocalFilterParams] = useState<Record<string, string>>(
    node.local_filter_params ?? {}
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the node when the layout is (re)loaded with a different filter.
  const nodeParamsJson = JSON.stringify(node.local_filter_params ?? {});
  useEffect(() => {
    const fromNode = JSON.parse(nodeParamsJson) as Record<string, string>;
    setLocalFilterParams((prev) => (sameParams(prev, fromNode) ? prev : fromNode));
  }, [nodeParamsJson]);

  const handleLocalFilterChange = useCallback(
    (params: Record<string, string>) => {
      setLocalFilterParams(params);
      const persisted = Object.keys(params).length > 0 ? params : null;
      onUpdate?.({ local_filter_params: persisted });
      const { x, y } = node;
      if (!dashboardId || x == null || y == null) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        saveDashboardWidgetLocalFilter(dashboardId, x, y, persisted).catch(() => {});
      }, DEBOUNCE_MS);
    },
    [dashboardId, node, onUpdate],
  );

  return [localFilterParams, handleLocalFilterChange] as const;
}
