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
  /** the backend capped the result set; `maxRows` says where */
  truncated?: boolean;
  maxRows?: number;
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
  query: string
): Promise<QueryResultShape> {
  try {
    const { data } = await axios.post(`/api/files/${fileId}/execute_query/`, {
      query,
    });
    return {
      data: data.data ?? [],
      columns: data.columns ?? [],
      truncated: data.truncated ?? false,
      maxRows: data.max_rows,
    };
  } catch (err) {
    throw new Error(extractErrorMessage(err, "Query failed"));
  }
}
