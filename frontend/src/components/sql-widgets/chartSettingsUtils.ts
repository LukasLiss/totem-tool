/**
 * Hooks for the chart settings popups (chartSettings.tsx): looking up the
 * query's columns once when a popup opens, and loading the categories the
 * chart will show, for the per-category colors.
 */

import { useEffect, useMemo, useRef } from "react";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { useSqlQueryData } from "@/react_component/sql/useSqlQueryData";
import { limitCategories, rowsToCategories, type CategorySlice } from "./chartData";
import type { ColumnDiscovery } from "./sqlWidgetUtils";

/** Looks up the query's columns once on open, so the column dropdowns are ready. */
export function useDiscoverOnOpen(
  discovery: ColumnDiscovery,
  fileId: number | undefined,
  query: string,
  linked: LinkedQuery | null
) {
  const { discover } = discovery;
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (fileId && (query.trim() || linked)) void discover();
  }, [discover, fileId, query, linked]);
}

export interface CategoryList {
  /** The categories as the chart will show them (after Max categories). */
  slices: CategorySlice[];
  loading: boolean;
  error: string | null;
  /** Label or value column not chosen yet, so there is nothing to load. */
  needsColumns: boolean;
}

/** Runs the draft query (only while `enabled`) and shapes it like the chart does. */
export function useCategoryList({
  fileId,
  query,
  linked,
  labelColumn,
  valueColumn,
  enabled,
  maxCategories,
  groupRest,
}: {
  fileId?: number;
  query: string;
  linked: LinkedQuery | null;
  labelColumn: string;
  valueColumn: string;
  enabled: boolean;
  maxCategories: number | null;
  groupRest: boolean;
}): CategoryList {
  const needsColumns = !(labelColumn && valueColumn);
  const data = useSqlQueryData({
    fileId,
    query,
    queryAssetId: linked?.id,
    enabled: enabled && !needsColumns,
    limit: 500,
  });
  const slices = useMemo(
    () =>
      needsColumns
        ? []
        : limitCategories(rowsToCategories(data.rows, labelColumn, valueColumn), maxCategories, {
            groupRest,
          }),
    [data.rows, needsColumns, labelColumn, valueColumn, maxCategories, groupRest]
  );
  return { slices, loading: data.loading, error: data.error, needsColumns };
}
