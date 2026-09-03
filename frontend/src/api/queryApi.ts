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
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail ?? err.response?.data?.error;
    if (detail) return String(detail);
    if (err.response?.status) return `Query failed (${err.response.status})`;
  }
  return err instanceof Error ? err.message : fallback;
}

export async function getQueryColumns(fileId: number): Promise<TableSchema[]> {
  const { data } = await axios.get(
    `http://localhost:8000/api/query/columns/?file_id=${fileId}`
  );
  return data.tables ?? [];
}

export async function executeQuery(
  fileId: number,
  query: string
): Promise<QueryResultShape> {
  try {
    const { data } = await axios.post(
      "http://localhost:8000/api/query/execute/",
      { file_id: fileId, query }
    );
    return { data: data.data ?? [], columns: data.columns ?? [] };
  } catch (err) {
    throw new Error(extractErrorMessage(err, "Query failed"));
  }
}
