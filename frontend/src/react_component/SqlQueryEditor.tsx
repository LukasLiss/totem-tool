/**
 * SqlQueryEditor — standalone SQL editor + table/column browser + result
 * viewer for a file's OCEL data (DuckDB, SELECT-only). See
 * Claude_design/README.md for the full behavioral spec this follows.
 *
 * This is a plain, dashboard-agnostic React component: it owns no
 * persistence itself. A caller supplies the current `value` and an
 * `onChange` to receive patches (e.g. the dashboard's SqlQueryComponent in
 * componentMap.tsx wires this up to a GridStack widget node), so it can
 * just as well be embedded in a dialog, a panel, or any other page.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, Database, Play, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  executeQuery as runSqlQuery,
  getQueryColumns,
  type TableSchema,
} from "@/api/queryApi";

export interface SqlQueryConfig {
  /** what other widgets could bind to (name-based source lookup — not wired to any consumer yet) */
  name: string;
  query: string;
  /** optional human annotation of the expected result shape; absent/null hides the pane */
  expectedResult?: string | null;
  /** rows rendered in the result table, default 25 */
  rowLimit?: number;
}

export interface SqlQueryEditorProps {
  value: SqlQueryConfig;
  onChange: (patch: Partial<SqlQueryConfig>) => void;
  /** edit mode = editor + browser + test run; false = result viewer only, auto-runs */
  isEditMode: boolean;
  /** the OCEL file to query against; omit to disable running (schema falls back to a static list) */
  fileId?: number;
  className?: string;
}

export const SQL_QUERY_DEFAULT =
  "SELECT activity, count(*) AS n FROM events GROUP BY activity";

const SQL_SELECT_ONLY = /^\s*(--[^\n]*\n\s*)*(select|with)\b/i;

const SQL_FALLBACK_SCHEMA: TableSchema[] = [
  { name: "events", columns: [] },
  { name: "objects", columns: [] },
  { name: "event_object", columns: [] },
  { name: "object_attribute_history", columns: [] },
  { name: "object_relations", columns: [] },
];

interface SqlQueryResult {
  data: Record<string, unknown>[];
  columns: string[];
  ms: number;
}

const SqlQueryEditor: React.FC<SqlQueryEditorProps> = ({
  value,
  onChange,
  isEditMode,
  fileId,
  className,
}) => {
  const rowLimit = value.rowLimit ?? 25;

  // Some hosts (e.g. the dashboard grid) mount this via a one-off ReactDOM
  // root that isn't re-rendered on every onChange. So text fields need
  // local state (mirrored from `value` via useEffect) to stay editable; a
  // value bound straight to props would look "frozen" mid-keystroke if the
  // host never re-renders this tree in response to onChange.
  const [name, setName] = useState(value.name ?? "");
  const [query, setQuery] = useState(value.query ?? SQL_QUERY_DEFAULT);
  const [expectedResult, setExpectedResult] = useState<string | null>(
    value.expectedResult ?? null
  );
  const [schema, setSchema] = useState<TableSchema[]>(SQL_FALLBACK_SCHEMA);
  const [expanded, setExpanded] = useState<string | null>("events");
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const chipClickTimer = useRef<number | null>(null);

  // A double-click fires two "click" events before "dblclick", so a naive
  // onClick would toggle the column browser open then immediately closed
  // (or vice versa) on every double-click. Defer the single-click action so
  // a following dblclick within the window can cancel it.
  useEffect(() => {
    return () => {
      if (chipClickTimer.current != null) clearTimeout(chipClickTimer.current);
    };
  }, []);

  useEffect(() => {
    setName(value.name ?? "");
  }, [value.name]);
  useEffect(() => {
    setQuery(value.query ?? SQL_QUERY_DEFAULT);
  }, [value.query]);
  useEffect(() => {
    setExpectedResult(value.expectedResult ?? null);
  }, [value.expectedResult]);

  useEffect(() => {
    if (!fileId) {
      setSchema(SQL_FALLBACK_SCHEMA);
      return;
    }
    let alive = true;
    getQueryColumns(fileId)
      .then((tables) => {
        if (alive) setSchema(tables.length ? tables : SQL_FALLBACK_SCHEMA);
      })
      .catch(() => {
        if (alive) setSchema(SQL_FALLBACK_SCHEMA);
      });
    return () => {
      alive = false;
    };
  }, [fileId]);

  const run = useCallback(
    async (q: string = query) => {
      if (!q.trim()) return;
      if (!fileId) {
        setResult(null);
        setError("Select an event log to run queries against.");
        return;
      }
      if (!SQL_SELECT_ONLY.test(q)) {
        setResult(null);
        setError("Only SELECT queries are allowed.");
        return;
      }
      setRunning(true);
      const t0 = performance.now();
      try {
        const { data, columns } = await runSqlQuery(fileId, q);
        setResult({ data, columns, ms: Math.round(performance.now() - t0) });
        setError(null);
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    },
    [query, fileId]
  );

  // View mode auto-runs; edit-mode authoring runs are explicit (Run / ⌘↵).
  useEffect(() => {
    if (!isEditMode) void run(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, query, fileId]);

  const patchName = (v: string) => {
    setName(v);
    onChange({ name: v });
  };
  const patchQuery = (v: string) => {
    setQuery(v);
    onChange({ query: v });
  };
  const patchExpectedResult = (v: string | null) => {
    setExpectedResult(v);
    onChange({ expectedResult: v });
  };

  /** alias used for `table` in the current query, if any */
  const aliasFor = (table: string) => {
    const m = query.match(
      new RegExp(`\\b(?:from|join)\\s+${table}\\s+(?:as\\s+)?([a-z_]\\w*)`, "i")
    );
    if (m && !/^(where|group|order|limit|join|left|inner|on|having)$/i.test(m[1])) {
      return m[1];
    }
    return new RegExp(`\\b(?:from|join)\\s+${table}\\b`, "i").test(query)
      ? table
      : null;
  };

  /** insert `text` at the editor's caret (replacing any selection) */
  const insertAtCaret = (text: string) => {
    const ta = editorRef.current;
    const pos = ta?.selectionStart ?? query.length;
    const end = ta?.selectionEnd ?? pos;
    patchQuery(query.slice(0, pos) + text + query.slice(end));
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(pos + text.length, pos + text.length);
    });
  };

  const insertColumn = (table: string, column: string) => {
    const alias = aliasFor(table);
    insertAtCaret(alias ? `${alias}.${column}` : column);
  };

  const rows = useMemo(() => result?.data.slice(0, rowLimit) ?? [], [result, rowLimit]);
  const numericCols = useMemo(() => {
    const cols = result?.columns ?? [];
    return new Set(
      cols.filter((c) =>
        (result?.data ?? []).every((r) => r[c] == null || typeof r[c] === "number")
      )
    );
  }, [result]);

  const statusCaption = running
    ? "running…"
    : error
      ? "failed"
      : result
        ? `${result.data.length.toLocaleString()} rows · ${result.columns.length} cols · ${result.ms} ms`
        : "—";

  const errorBox = (
    <div
      className="m-3 rounded-lg border p-3"
      style={{ borderColor: "hsl(0,70%,88%)", background: "hsl(0,86%,98%)" }}
    >
      <p className="font-mono text-xs font-medium" style={{ color: "hsl(0,65%,42%)" }}>
        Query error
      </p>
      <p
        className="mt-1 whitespace-pre-wrap font-mono text-xs"
        style={{ color: "hsl(0,40%,28%)" }}
      >
        {error}
      </p>
    </div>
  );

  /**
   * `alignNumeric` right-aligns numeric columns (the edit-mode "Your
   * result" pane, matching the design spec). Display mode passes false —
   * all columns left-aligned — per request, for a more uniform look.
   */
  const renderResultTable = (alignNumeric: boolean) => (
    <div className="overflow-auto" style={{ scrollbarGutter: "stable" }}>
      <Table>
        <TableHeader>
          <TableRow>
            {(result?.columns ?? []).map((c, i) => (
              <TableHead
                key={c}
                className={cn(
                  "whitespace-nowrap text-left font-mono text-[11px]",
                  alignNumeric && numericCols.has(c) && "text-right"
                )}
                style={{
                  color: "hsl(240,3.8%,46.1%)",
                  background: "hsl(240,4.8%,97%)",
                  padding: "7px 14px",
                  borderRight:
                    i < (result?.columns.length ?? 0) - 1
                      ? "1px solid hsl(240,5.9%,90%)"
                      : undefined,
                }}
              >
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {(result?.columns ?? []).map((c, j) => (
                <TableCell
                  key={c}
                  className={cn(
                    "overflow-hidden text-ellipsis whitespace-nowrap text-left text-[12.5px]",
                    numericCols.has(c) && "font-mono",
                    alignNumeric && numericCols.has(c) && "text-right"
                  )}
                  style={{
                    padding: "7px 14px",
                    borderBottom: "1px solid hsl(240,5.9%,95%)",
                    borderRight:
                      j < (result?.columns.length ?? 0) - 1
                        ? "1px solid hsl(240,5.9%,95%)"
                        : undefined,
                  }}
                >
                  {r[c] == null ? (
                    <span className="text-muted-foreground">NULL</span>
                  ) : typeof r[c] === "number" ? (
                    (r[c] as number).toLocaleString()
                  ) : (
                    String(r[c])
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {result && result.data.length === 0 && (
        <p className="px-4 py-6 text-[11px]" style={{ color: "hsl(240,4%,60%)" }}>
          no rows returned
        </p>
      )}
      {result && result.data.length > 0 && rows.length < result.data.length && (
        <p className="px-4 py-2 text-[11px]" style={{ color: "hsl(240,4%,60%)" }}>
          showing first {rows.length} of {result.data.length.toLocaleString()} rows
        </p>
      )}
      {result && result.data.length > 0 && rows.length >= result.data.length && (
        <p className="px-4 py-2 text-[11px]" style={{ color: "hsl(240,4%,60%)" }}>
          end of result
        </p>
      )}
      {!result && !running && !error && (
        <p className="px-4 py-6 text-xs text-muted-foreground">Run a query to see results.</p>
      )}
    </div>
  );

  /* ------------------------------------------------------------ view mode */

  if (!isEditMode) {
    return (
      <Card className={cn("flex h-full w-full flex-col overflow-hidden text-left", className)}>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 border-b py-3">
          <CardTitle className="min-w-0 flex-1 truncate text-sm">
            {name || "SQL query"}
          </CardTitle>
          <Badge
            variant="outline"
            className="shrink-0 whitespace-nowrap font-mono text-[10px]"
          >
            {statusCaption}
          </Badge>
        </CardHeader>
        <CardContent
          className="flex-1 overflow-auto p-0 pr-3 pl-3"
          style={{ scrollbarGutter: "stable" }}
        >
          {error ? errorBox : renderResultTable(false)}
        </CardContent>
      </Card>
    );
  }

  /* ------------------------------------------------------------ edit mode */

  const expandedTable = schema.find((t) => t.name === expanded) ?? null;

  return (
    <Card className={cn("flex h-full w-full flex-col overflow-hidden text-left", className)}>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 border-b py-2.5">
        <span
          className="h-2 w-2 rounded-[2px]"
          style={{
            background:
              !running && !error && result ? "hsl(142,71%,45%)" : "hsl(240,5.9%,88%)",
          }}
        />
        <Database className="size-4 shrink-0 text-muted-foreground" />
        <CardTitle className="shrink-0 whitespace-nowrap text-sm">SQL Editor</CardTitle>
        <Input
          value={name}
          onChange={(e) => patchName(e.target.value)}
          placeholder="query name"
          className="h-7 w-[190px] min-w-[60px] shrink font-mono text-[11px]"
        />
        <span className="ml-auto min-w-0 flex-1 truncate whitespace-nowrap text-right text-[11px] text-muted-foreground">
          DuckDB · SELECT-only
        </span>
      </CardHeader>

      <CardContent className="@container flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto p-0">
        <Textarea
          ref={editorRef}
          value={query}
          onChange={(e) => patchQuery(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
          spellCheck={false}
          placeholder={SQL_QUERY_DEFAULT}
          className="min-h-[132px] resize-none rounded-none border-0 border-b bg-[hsl(240,20%,99%)] font-mono text-[13px] leading-[22px] focus-visible:ring-0"
        />

        {/* table chips */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3.5 py-2">
          <span className="mr-1 text-xs font-semibold text-muted-foreground">Tables</span>
          {schema.map((t) => {
            const active = expanded === t.name;
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => {
                  if (chipClickTimer.current != null) clearTimeout(chipClickTimer.current);
                  chipClickTimer.current = window.setTimeout(() => {
                    setExpanded((prev) => (prev === t.name ? null : t.name));
                    chipClickTimer.current = null;
                  }, 220);
                }}
                onDoubleClick={() => {
                  if (chipClickTimer.current != null) {
                    clearTimeout(chipClickTimer.current);
                    chipClickTimer.current = null;
                  }
                  insertAtCaret(t.name);
                }}
                title="Click to browse columns, double-click to insert the table name"
                className="rounded-full border bg-background px-3 py-1 font-mono text-xs transition-colors hover:bg-accent"
                style={
                  active
                    ? {
                        background: "hsl(142,60%,90%)",
                        borderColor: "hsl(142,45%,70%)",
                        color: "hsl(142,60%,22%)",
                      }
                    : undefined
                }
              >
                {t.name}
              </button>
            );
          })}
          <span className="ml-auto text-[11px]" style={{ color: "hsl(240,4%,60%)" }}>
            double-click a table or column to insert
          </span>
        </div>

        {/* column browser */}
        {expandedTable && (
          <div className="border-b">
            <div className="flex items-center gap-2 px-4 pb-1 pt-2">
              <ChevronDown className="size-3.5 text-muted-foreground" />
              <span className="font-mono text-[13px] font-medium">{expandedTable.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {expandedTable.columns.length
                  ? `${expandedTable.columns.length} columns${
                      expandedTable.rowCount
                        ? ` · ${expandedTable.rowCount.toLocaleString()} rows`
                        : ""
                    }`
                  : "schema unavailable — /api/query/columns not reachable"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 px-4 pb-3 pt-1">
              {expandedTable.columns.map((c) => (
                <div
                  key={c.name}
                  onDoubleClick={() => insertColumn(expandedTable.name, c.name)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                >
                  <span className="font-mono text-[12.5px]">{c.name}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {c.type}
                    {c.note ? ` · ${c.note}` : ""}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-5 rounded-[5px] border font-mono text-[11px]"
                    style={{ color: "hsl(212,92%,45%)", borderColor: "hsl(212,60%,85%)" }}
                    onClick={() => insertColumn(expandedTable.name, c.name)}
                    aria-label={`insert ${c.name}`}
                  >
                    <Plus className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* your result | expected result — side-by-side once the widget is
            wide enough (@container), stacked otherwise so a small widget
            never forces both panes to be unreadably narrow */}
        <div
          className={cn(
            "grid min-h-[160px] flex-1",
            expectedResult != null ? "@[560px]:grid-cols-2" : "grid-cols-1"
          )}
        >
          <div className="flex min-h-[140px] flex-col border-b @[560px]:min-h-0 @[560px]:border-b-0 @[560px]:border-r">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
              <span className="text-xs font-semibold">Your result</span>
              <span className="text-[11px] text-muted-foreground">{statusCaption}</span>
              <div className="ml-auto flex items-center gap-3">
                {expectedResult == null && (
                  <button
                    type="button"
                    onClick={() => patchExpectedResult("")}
                    className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    + expected result
                  </button>
                )}
                <Button size="sm" className="h-7 gap-1.5 px-3" disabled={running} onClick={() => void run()}>
                  <Play className="size-3" /> Run
                  <span className="font-mono text-[10px] opacity-60">⌘↵</span>
                </Button>
              </div>
            </div>
            <div
              className="min-h-0 flex-1 overflow-auto pr-2"
              style={{ scrollbarGutter: "stable" }}
            >
              {error ? errorBox : renderResultTable(true)}
            </div>
          </div>

          {expectedResult != null && (
            <div className="flex min-h-[140px] flex-col bg-muted/20 @[560px]:min-h-0">
              <div className="flex min-w-0 items-center gap-2 border-b bg-muted/40 px-3 py-2">
                <span className="shrink-0 whitespace-nowrap text-xs font-semibold">
                  Expected result
                </span>
                <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[11px] text-muted-foreground">
                  optional annotation · shown to consumers
                </span>
                <button
                  type="button"
                  onClick={() => patchExpectedResult(null)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Remove expected result"
                  title="Remove expected result"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <Textarea
                value={expectedResult}
                onChange={(e) => patchExpectedResult(e.target.value)}
                placeholder="Describe the shape consumers should expect, e.g. one row per activity with an integer count."
                className="m-3 min-h-[80px] w-auto text-xs"
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default SqlQueryEditor;
