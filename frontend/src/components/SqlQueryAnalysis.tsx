/**
 * The "SQL Queries" entry of the Analysis section: the full SQL editor
 * against the selected event log, with access to the project's query store.
 * The draft is kept in sessionStorage so switching views does not lose it.
 */

import React, { useCallback, useEffect, useState } from "react";
import SqlQueryEditor, {
  SQL_QUERY_DEFAULT,
  type LinkedQuery,
  type SqlQueryConfig,
} from "@/react_component/SqlQueryEditor";

const STORAGE_KEY = "totem.analysis.sql";

interface Draft extends SqlQueryConfig {
  linkedQuery: LinkedQuery | null;
}

function loadDraft(): Draft {
  const fallback: Draft = { name: "", query: SQL_QUERY_DEFAULT, rowLimit: 50, linkedQuery: null };
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      query: typeof parsed.query === "string" ? parsed.query : SQL_QUERY_DEFAULT,
      rowLimit: typeof parsed.rowLimit === "number" ? parsed.rowLimit : 50,
      linkedQuery:
        parsed.linkedQuery && typeof parsed.linkedQuery.id === "number"
          ? { id: parsed.linkedQuery.id, name: String(parsed.linkedQuery.name ?? "") }
          : null,
    };
  } catch {
    return fallback;
  }
}

export function SqlQueryAnalysis({
  fileId,
  projectId,
  height = 760,
}: {
  fileId?: number;
  projectId?: number;
  height?: number;
}) {
  const [draft, setDraft] = useState<Draft>(loadDraft);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* storage may be unavailable; the draft then only lives in memory */
    }
  }, [draft]);

  const handleChange = useCallback((patch: Partial<SqlQueryConfig>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);
  const handleLinkChange = useCallback((linkedQuery: LinkedQuery | null) => {
    setDraft((prev) => ({ ...prev, linkedQuery }));
  }, []);

  return (
    <div style={{ height }}>
      <SqlQueryEditor
        value={draft}
        onChange={handleChange}
        isEditMode
        fileId={fileId}
        projectId={projectId}
        linkedQuery={draft.linkedQuery}
        onLinkChange={handleLinkChange}
      />
    </div>
  );
}

export default SqlQueryAnalysis;
