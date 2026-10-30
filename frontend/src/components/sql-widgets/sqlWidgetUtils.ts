/**
 * Non-component helpers shared by the SQL-driven dashboard widgets: the
 * props contract with the grid host, column discovery, and value coercion.
 */

import { useCallback, useState } from "react";
import type { GridStackNode } from "gridstack";
import { executeQuery } from "@/api/queryApi";
import { getAsset, queryAssetSql } from "@/api/assetsApi";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";

/** node fields every SQL-driven widget persists */
export interface SqlWidgetNodeFields {
  component_id: number;
  component_name?: string;
  title?: string;
  query?: string;
  query_asset?: number | null;
  /** display name of the linked stored query (not persisted server-side) */
  query_asset_name?: string | null;
}

export interface SqlWidgetProps<TNode extends SqlWidgetNodeFields = SqlWidgetNodeFields> {
  node: GridStackNode & TNode;
  onUpdate?: (updates: Partial<GridStackNode> & Record<string, unknown>) => void;
  isEditMode?: boolean;
  dashboardId: number;
  selectedFile?: { id: number; project?: number; [key: string]: unknown };
}

export function linkedQueryOf(node: SqlWidgetNodeFields): LinkedQuery | null {
  return node.query_asset
    ? { id: node.query_asset, name: node.query_asset_name ?? `stored query #${node.query_asset}` }
    : null;
}

/** A query result to hand to column discovery, e.g. from a run in the SQL editor. */
export interface QueryResultSample {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface ColumnDiscovery {
  columns: string[];
  /** The first row(s) of the last result, e.g. for a KPI preview. */
  rows: Record<string, unknown>[];
  /** Which query (see discoveryKey) `columns` and `rows` came from; null before any result. */
  resultFor: string | null;
  loading: boolean;
  error: string | null;
  discover: () => Promise<void>;
  /** Takes a result the user already ran elsewhere instead of querying again. */
  accept: (result: QueryResultSample, query: string, queryAssetId?: number | null) => void;
}

/** Identifies a query (local text or linked stored query) for ColumnDiscovery.resultFor. */
export function discoveryKey(query: string, queryAssetId?: number | null): string {
  return queryAssetId ? `asset:${queryAssetId}` : `sql:${query}`;
}

/** column discovery: run the (local or linked) query once with LIMIT 1 */
export function useColumnDiscovery(
  fileId: number | undefined,
  query: string,
  queryAssetId: number | null | undefined
): ColumnDiscovery {
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [resultFor, setResultFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discover = useCallback(async () => {
    if (!fileId) {
      setError("Select an event log first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let sql = query;
      if (queryAssetId) {
        sql = queryAssetSql(await getAsset(queryAssetId));
      }
      if (!sql.trim()) {
        setError("Enter a query first.");
        setColumns([]);
        setRows([]);
        setResultFor(null);
        return;
      }
      const page = await executeQuery(fileId, sql, { offset: 0, limit: 1 });
      setColumns(page.columns);
      setRows(page.data);
      setResultFor(discoveryKey(query, queryAssetId));
    } catch (err) {
      setColumns([]);
      setRows([]);
      setResultFor(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [fileId, query, queryAssetId]);

  const accept = useCallback(
    (result: QueryResultSample, resultQuery: string, resultAssetId?: number | null) => {
      setColumns(result.columns);
      setRows(result.rows);
      setResultFor(discoveryKey(resultQuery, resultAssetId));
      setError(null);
    },
    []
  );

  return { columns, rows, resultFor, loading, error, discover, accept };
}

/** first column whose values are all numeric (or null); "" when none */
export function firstNumericColumn(rows: Record<string, unknown>[], columns: string[]) {
  return (
    columns.find(
      (c) => rows.length > 0 && rows.every((r) => r[c] == null || typeof r[c] === "number")
    ) ?? ""
  );
}

export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "bigint") return Number(v);
  return null;
}
