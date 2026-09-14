import axios from "axios";

export interface ColumnSchema {
  name: string;
  type: string;
  note?: string | null;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  rowCount?: number;
}

export interface QueryResultShape {
  data: Record<string, unknown>[];
  columns: string[];
  /** more rows exist beyond this page (`offset + limit`) */
  hasMore: boolean;
  /** first row index of this page (0-based) */
  offset: number;
  /** page size the server actually applied (clamped to its cap) */
  limit: number;
  /** @deprecated alias of `hasMore`, kept for older callers */
  truncated?: boolean;
  maxRows?: number;
}

export interface QueryPageOptions {
  /** first row to return (0-based), default 0 */
  offset?: number;
  /** rows per page; omitted = the server cap (10 000) */
  limit?: number;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail ?? err.response?.data?.error;
    if (detail) return String(detail);
    if (err.response?.status) return `Query failed (${err.response.status})`;
  }
  return err instanceof Error ? err.message : fallback;
}

// Paths are relative on purpose: `interceptors/axios.js` sets
// `axios.defaults.baseURL = API_BASE_URL`, so these resolve against the
// deployed backend (VITE_API_URL / VITE_BACKEND_URL) rather than localhost,
// and still pick up the auth-refresh and global-filter interceptors.
export async function getQueryColumns(fileId: number): Promise<TableSchema[]> {
  const { data } = await axios.get(`/api/files/${fileId}/query_columns/`);
  return data.tables ?? [];
}

/**
 * Runs a read-only SELECT against one log.
 *
 * This is the shared, sandboxed endpoint on EventLogViewSet — the same one
 * `fileApi.executeQuery` uses. It parses the statement with DuckDB and
 * rejects anything that is not exactly one SELECT, then runs it on a
 * throwaway connection with external file access disabled.
 */
export async function executeQuery(
  fileId: number,
  query: string,
  page: QueryPageOptions = {}
): Promise<QueryResultShape> {
  try {
    const body: Record<string, unknown> = { query };
    if (page.offset !== undefined) body.offset = page.offset;
    if (page.limit !== undefined) body.limit = page.limit;
    const { data } = await axios.post(`/api/files/${fileId}/execute_query/`, body);
    const hasMore = Boolean(data.has_more ?? data.truncated ?? false);
    return {
      data: data.data ?? [],
      columns: data.columns ?? [],
      hasMore,
      offset: data.offset ?? page.offset ?? 0,
      limit: data.limit ?? data.max_rows ?? page.limit ?? 0,
      truncated: hasMore,
      maxRows: data.max_rows,
    };
  } catch (err) {
    throw new Error(extractErrorMessage(err, "Query failed"));
  }
}
