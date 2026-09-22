/**
 * Runs a component's query (local text or linked stored query) against the
 * selected log and hands back rows + columns. Used by the chart / KPI
 * widgets in view mode and for column discovery in edit mode.
 */

import { useCallback, useEffect, useState } from "react";
import { executeQuery } from "@/api/queryApi";
import { useEffectiveQuery } from "./useStoredQuery";

export interface SqlQueryDataState {
  rows: Record<string, unknown>[];
  columns: string[];
  loading: boolean;
  error: string | null;
  /** more rows existed than `limit`; charts show the first page only */
  truncated: boolean;
  /** the SQL that was (or would be) run */
  query: string;
  refresh: () => void;
}

export interface UseSqlQueryDataOptions {
  fileId?: number;
  query: string;
  queryAssetId?: number | null;
  /** false = do not run (e.g. while editing) */
  enabled?: boolean;
  /** rows to fetch, default 2000 (plenty for a chart) */
  limit?: number;
  /** bump to force a re-run */
  refreshKey?: unknown;
}

export function useSqlQueryData({
  fileId,
  query,
  queryAssetId,
  enabled = true,
  limit = 2000,
  refreshKey,
}: UseSqlQueryDataOptions): SqlQueryDataState {
  const effective = useEffectiveQuery(query, queryAssetId);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const sql = effective.query;
  const ready = effective.ready;
  const storedError = effective.stored.error;

  useEffect(() => {
    if (!enabled) return;
    if (storedError) {
      setRows([]);
      setColumns([]);
      setError(storedError);
      return;
    }
    if (!ready) return;
    if (!fileId) {
      setRows([]);
      setColumns([]);
      setError("Select an event log first.");
      return;
    }
    if (!sql.trim()) {
      setRows([]);
      setColumns([]);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    executeQuery(fileId, sql, { offset: 0, limit })
      .then((page) => {
        if (!alive) return;
        setRows(page.data);
        setColumns(page.columns);
        setTruncated(page.hasMore);
      })
      .catch((err) => {
        if (!alive) return;
        setRows([]);
        setColumns([]);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [enabled, fileId, sql, ready, storedError, limit, tick, refreshKey]);

  return { rows, columns, loading, error, truncated, query: sql, refresh };
}
