/**
 * SqlQueryEditor — standalone SQL editor + table/column browser + result
 * viewer for a file's OCEL data (DuckDB, SELECT-only).
 *
 * This is a plain, dashboard-agnostic React component: it owns no
 * persistence itself. A caller supplies the current `value` and an
 * `onChange` to receive patches (e.g. the dashboard's SqlQueryComponent in
 * componentMap.tsx wires this up to a GridStack widget node), so it can
 * just as well be embedded in a dialog, a panel, or any other page.
 *
 * Results are paged: the first `rowLimit` rows load on Run, further pages
 * load lazily as the table is scrolled (or via "Load more").
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BookmarkPlus,
  ChevronDown,
  Database,
  FolderOpen,
  Link2,
  Play,
  Plus,
  Save,
  Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  executeQuery as runSqlQuery,
  getQueryColumns,
  type TableSchema,
} from "@/api/queryApi";
import { queryAssetSql, type ProjectAsset } from "@/api/assetsApi";
import { SqlHighlightedTextarea } from "./sql/SqlHighlightedTextarea";
import { columnReference, quoteIdentifierIfNeeded } from "./sql/sqlIdentifiers";
import { useStoredQuery } from "./sql/useStoredQuery";
import { SaveStoredQueryDialog, StoredQueryPickerDialog } from "./sql/StoredQueryDialogs";
import { toLinkedQuery, type LinkedQuery } from "./sql/linkedQuery";

export type { LinkedQuery } from "./sql/linkedQuery";

export interface SqlQueryConfig {
  /** display name of the query (widget title in view mode) */
  name: string;
  query: string;
  /** rows per page of the result table, default 25 */
  rowLimit?: number;
}

/**
 * What a consumer of the query expects the result to look like. Provided by
 * components that ask the user for a query (KPI, bar chart, …); the editor
 * only displays it, it is never edited here.
 */
export interface ExpectedResult {
  description?: string;
  columns?: string[];
  /** example rows, in `columns` order */
  rows?: unknown[][];
}

export interface SqlQueryEditorProps {
  value: SqlQueryConfig;
  onChange: (patch: Partial<SqlQueryConfig>) => void;
  /** edit mode = editor + browser + test run; false = result viewer only, auto-runs */
  isEditMode: boolean;
  /** the OCEL file to query against; omit to disable running (schema falls back to a static list) */
  fileId?: number;
  /** project whose query store the editor can save to / load from; omit to hide the store menu */
  projectId?: number;
  /** read-only description of the result a consumer expects; omit to hide the pane */
  expectedResult?: ExpectedResult | null;
  /** stored query this editor is linked to (its text is shown and run) */
  linkedQuery?: LinkedQuery | null;
  /** called when the user links / unlinks a stored query; omit to disable linking */
  onLinkChange?: (link: LinkedQuery | null) => void;
  /** hide the query-name input (e.g. when a dialog already names the query) */
  hideName?: boolean;
  className?: string;
}

export const SQL_QUERY_DEFAULT =
  "SELECT activity, count(*) AS n FROM events GROUP BY activity";

const SQL_PAGE_SIZES = [25, 50, 100, 500] as const;

const SQL_SELECT_ONLY = /^\s*(--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(select|with)\b/i;

const SQL_FALLBACK_SCHEMA: TableSchema[] = [
  { name: "events", columns: [] },
  { name: "objects", columns: [] },
  { name: "event_object", columns: [] },
  { name: "object_attribute_history", columns: [] },
  { name: "object_relations", columns: [] },
];

interface SqlQueryResult {
  rows: Record<string, unknown>[];
  columns: string[];
  hasMore: boolean;
  /** wall time of the first page */
  ms: number;
}

const formatCell = (v: unknown) =>
  v == null ? (
    <span className="text-muted-foreground">NULL</span>
  ) : typeof v === "number" ? (
    v.toLocaleString()
  ) : (
    String(v)
  );

const SqlQueryEditor: React.FC<SqlQueryEditorProps> = ({
  value,
  onChange,
  isEditMode,
  fileId,
  projectId,
  expectedResult = null,
  linkedQuery = null,
  onLinkChange,
  hideName = false,
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
  const [schema, setSchema] = useState<TableSchema[]>(SQL_FALLBACK_SCHEMA);
  const [expanded, setExpanded] = useState<string | null>("events");
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTarget, setSaveTarget] = useState<ProjectAsset | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const chipClickTimer = useRef<number | null>(null);
  const runSeq = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Linked stored query: its text replaces the local one while linked.
  const stored = useStoredQuery(linkedQuery?.id);
  const linked = Boolean(linkedQuery);
  const storedQueryText = stored.asset ? queryAssetSql(stored.asset) : null;
  const dirtyAgainstStore = linked && storedQueryText != null && storedQueryText !== query;

  useEffect(() => {
    return () => {
      if (chipClickTimer.current != null) clearTimeout(chipClickTimer.current);
    };
  }, []);

  useEffect(() => {
    setName(value.name ?? "");
  }, [value.name]);
  useEffect(() => {
    if (!linked) setQuery(value.query ?? SQL_QUERY_DEFAULT);
  }, [value.query, linked]);
  useEffect(() => {
    if (storedQueryText != null) setQuery(storedQueryText);
  }, [storedQueryText]);

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
      const seq = ++runSeq.current;
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
        const page = await runSqlQuery(fileId, q, { offset: 0, limit: rowLimit });
        if (seq !== runSeq.current) return;
        setResult({
          rows: page.data,
          columns: page.columns,
          hasMore: page.hasMore,
          ms: Math.round(performance.now() - t0),
        });
        setError(null);
        scrollRef.current?.scrollTo({ top: 0 });
      } catch (e) {
        if (seq !== runSeq.current) return;
        setResult(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === runSeq.current) setRunning(false);
      }
    },
    [query, fileId, rowLimit]
  );

  const loadMore = useCallback(async () => {
    if (!fileId || !result?.hasMore || loadingMore || running) return;
    const seq = runSeq.current;
    setLoadingMore(true);
    try {
      const page = await runSqlQuery(fileId, query, {
        offset: result.rows.length,
        limit: rowLimit,
      });
      if (seq !== runSeq.current) return;
      setResult((prev) =>
        prev
          ? { ...prev, rows: prev.rows.concat(page.data), hasMore: page.hasMore }
          : prev
      );
    } catch (e) {
      if (seq !== runSeq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === runSeq.current) setLoadingMore(false);
    }
  }, [fileId, result, loadingMore, running, query, rowLimit]);

  // Lazy loading: fetch the next page when the sentinel below the last row
  // scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !result?.hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: scrollRef.current, rootMargin: "120px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [result, loadMore]);

  // View mode auto-runs; edit-mode authoring runs are explicit (Run / ⌘↵).
  // While linked, wait for the stored text before running anything.
  useEffect(() => {
    if (isEditMode) return;
    if (linked && storedQueryText == null) return;
    void run(linked ? storedQueryText ?? "" : query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, query, fileId, linked, storedQueryText, rowLimit]);

  const patchName = (v: string) => {
    setName(v);
    onChange({ name: v });
  };
  const patchQuery = (v: string) => {
    setQuery(v);
    onChange({ query: v });
  };
  const patchRowLimit = (v: number) => {
    onChange({ rowLimit: v });
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

  const insertTable = (table: string) => insertAtCaret(quoteIdentifierIfNeeded(table));
  const insertColumn = (table: string, column: string) =>
    insertAtCaret(columnReference(query, table, column));

  const useStoredCopy = (asset: ProjectAsset) => {
    patchQuery(queryAssetSql(asset));
    if (!name && !hideName) patchName(asset.name);
  };
  const linkStored = (asset: ProjectAsset) => {
    onLinkChange?.(toLinkedQuery(asset));
    setQuery(queryAssetSql(asset));
    onChange({ query: queryAssetSql(asset) });
    if (!name && !hideName) patchName(asset.name);
  };
  const unlink = () => {
    onLinkChange?.(null);
    onChange({ query });
  };

  const numericCols = useMemo(() => {
    const cols = result?.columns ?? [];
    const rows = result?.rows ?? [];
    return new Set(
      cols.filter((c) => rows.every((r) => r[c] == null || typeof r[c] === "number"))
    );
  }, [result]);

  const statusCaption = running
    ? "running…"
    : error
      ? "failed"
      : result
        ? `${result.rows.length.toLocaleString()} rows${result.hasMore ? "+" : ""} · ${result.columns.length} cols · ${result.ms} ms`
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

  const headCellStyle = (i: number, n: number, strong = false): React.CSSProperties => ({
    color: "hsl(240,3.8%,46.1%)",
    background: strong ? "hsl(240,4.8%,95%)" : "hsl(240,4.8%,97%)",
    padding: "7px 14px",
    borderRight: i < n - 1 ? "1px solid hsl(240,5.9%,90%)" : undefined,
  });
  const bodyCellStyle = (j: number, n: number): React.CSSProperties => ({
    padding: "7px 14px",
    borderBottom: "1px solid hsl(240,5.9%,95%)",
    borderRight: j < n - 1 ? "1px solid hsl(240,5.9%,95%)" : undefined,
  });

  /**
   * `alignNumeric` right-aligns numeric columns (the edit-mode "Your
   * result" pane). Display mode passes false — all columns left-aligned —
   * for a more uniform look.
   */
  const renderResultTable = (alignNumeric: boolean) => {
    const columns = result?.columns ?? [];
    const rows = result?.rows ?? [];
    return (
      <>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c, i) => (
                <TableHead
                  key={c}
                  className={cn(
                    "whitespace-nowrap text-left font-mono text-[11px]",
                    alignNumeric && numericCols.has(c) && "text-right"
                  )}
                  style={headCellStyle(i, columns.length)}
                >
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {columns.map((c, j) => (
                  <TableCell
                    key={c}
                    className={cn(
                      "overflow-hidden text-ellipsis whitespace-nowrap text-left text-[12.5px]",
                      numericCols.has(c) && "font-mono",
                      alignNumeric && numericCols.has(c) && "text-right"
                    )}
                    style={bodyCellStyle(j, columns.length)}
                  >
                    {formatCell(r[c])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {result && rows.length === 0 && (
          <p className="px-4 py-6 text-[11px]" style={{ color: "hsl(240,4%,60%)" }}>
            no rows returned
          </p>
        )}
        {result && rows.length > 0 && result.hasMore && (
          <div
            ref={sentinelRef}
            className="flex items-center gap-3 px-4 py-2 text-[11px]"
            style={{ color: "hsl(240,4%,60%)" }}
          >
            <span>
              {rows.length.toLocaleString()} rows loaded · more available
            </span>
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="rounded border px-2 py-0.5 font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              {loadingMore ? "loading…" : `Load ${rowLimit} more`}
            </button>
          </div>
        )}
        {result && rows.length > 0 && !result.hasMore && (
          <p className="px-4 py-2 text-[11px]" style={{ color: "hsl(240,4%,60%)" }}>
            end of result · {rows.length.toLocaleString()} rows
          </p>
        )}
        {!result && !running && !error && (
          <p className="px-4 py-6 text-xs text-muted-foreground">Run a query to see results.</p>
        )}
      </>
    );
  };

  const renderExpectedResult = () => {
    if (!expectedResult) return null;
    const columns = expectedResult.columns ?? [];
    const rows = expectedResult.rows ?? [];
    return (
      <div className="flex min-h-[140px] flex-col bg-muted/20 @[560px]:min-h-0">
        <div className="flex min-w-0 items-center gap-2 border-b bg-muted/40 px-3 py-2">
          <span className="shrink-0 whitespace-nowrap text-xs font-semibold">
            Expected result
          </span>
          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[11px] text-muted-foreground">
            what the consuming component reads from your query
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {expectedResult.description && (
            <p className="px-4 pb-2 pt-3 text-xs text-muted-foreground">
              {expectedResult.description}
            </p>
          )}
          {columns.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c, i) => (
                    <TableHead
                      key={c}
                      className="whitespace-nowrap text-left font-mono text-[11px]"
                      style={headCellStyle(i, columns.length, true)}
                    >
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    {columns.map((c, j) => (
                      <TableCell
                        key={c}
                        className="whitespace-nowrap text-left text-[12.5px]"
                        style={bodyCellStyle(j, columns.length)}
                      >
                        {formatCell(r[j])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------------ view mode */

  if (!isEditMode) {
    return (
      <Card className={cn("flex h-full w-full flex-col overflow-hidden text-left", className)}>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 border-b py-3">
          <CardTitle className="min-w-0 flex-1 truncate text-sm">
            {name || linkedQuery?.name || "SQL query"}
          </CardTitle>
          {linked && (
            <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]" title={`linked to stored query "${linkedQuery?.name}"`}>
              <Link2 className="size-3" /> linked
            </Badge>
          )}
          <Badge
            variant="outline"
            className="shrink-0 whitespace-nowrap font-mono text-[10px]"
          >
            {statusCaption}
          </Badge>
        </CardHeader>
        <CardContent
          ref={scrollRef}
          className="flex-1 overflow-auto p-0 pr-3 pl-3"
          style={{ scrollbarGutter: "stable" }}
        >
          {stored.error ? (
            <p className="px-4 py-6 text-xs text-destructive">{stored.error}</p>
          ) : error ? (
            errorBox
          ) : (
            renderResultTable(false)
          )}
        </CardContent>
      </Card>
    );
  }

  /* ------------------------------------------------------------ edit mode */

  const expandedTable = schema.find((t) => t.name === expanded) ?? null;
  const storeEnabled = Boolean(projectId);

  return (
    <Card className={cn("flex h-full w-full flex-col overflow-hidden text-left", className)}>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 border-b py-2.5">
        <span
          className="h-2 w-2 shrink-0 rounded-[2px]"
          style={{
            background:
              !running && !error && result ? "hsl(142,71%,45%)" : "hsl(240,5.9%,88%)",
          }}
        />
        <Database className="size-4 shrink-0 text-muted-foreground" />
        <CardTitle className="shrink-0 whitespace-nowrap text-sm">SQL Editor</CardTitle>
        {!hideName && (
          <Input
            value={name}
            onChange={(e) => patchName(e.target.value)}
            placeholder="query name"
            className="h-7 w-[190px] min-w-[60px] shrink font-mono text-[11px]"
          />
        )}
        {storeEnabled && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs">
                <FolderOpen className="size-3.5" /> Queries
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                Project query store
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setPickerOpen(true)}>
                <FolderOpen className="size-3.5" /> Load or link a stored query…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setSaveTarget(null);
                  setSaveOpen(true);
                }}
                disabled={!query.trim()}
              >
                <BookmarkPlus className="size-3.5" /> Store as new query…
              </DropdownMenuItem>
              {linked && stored.asset && (
                <DropdownMenuItem
                  onSelect={() => {
                    setSaveTarget(stored.asset);
                    setSaveOpen(true);
                  }}
                  disabled={!query.trim()}
                >
                  <Save className="size-3.5" /> Update "{stored.asset.name}"…
                </DropdownMenuItem>
              )}
              {linked && (
                <DropdownMenuItem onSelect={unlink}>
                  <Unlink className="size-3.5" /> Unlink (keep a local copy)
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {linked && (
          <Badge
            variant="secondary"
            className="min-w-0 shrink gap-1 truncate text-[10px]"
            title={`linked to stored query "${linkedQuery?.name}"`}
          >
            <Link2 className="size-3 shrink-0" />
            <span className="truncate">{stored.asset?.name ?? linkedQuery?.name}</span>
            {dirtyAgainstStore && <span className="shrink-0 text-amber-600">· unsaved</span>}
          </Badge>
        )}
        <span className="ml-auto min-w-0 flex-1 truncate whitespace-nowrap text-right text-[11px] text-muted-foreground">
          DuckDB · SELECT-only
        </span>
      </CardHeader>

      <CardContent className="@container flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto p-0">
        {stored.error && (
          <p className="border-b bg-destructive/5 px-3.5 py-1.5 text-xs text-destructive">
            {stored.error} Unlink to keep editing the local copy.
          </p>
        )}
        <SqlHighlightedTextarea
          ref={editorRef}
          value={query}
          onChange={patchQuery}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
          placeholder={SQL_QUERY_DEFAULT}
          className="min-h-[132px] shrink-0 border-b bg-[hsl(240,20%,99%)]"
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
                  // A double-click fires two "click" events before "dblclick",
                  // so defer the single-click toggle and let a following
                  // dblclick within the window cancel it.
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
                  insertTable(t.name);
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
                  : "schema unavailable — could not load the table list"}
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
            expectedResult ? "@[560px]:grid-cols-2" : "grid-cols-1"
          )}
        >
          <div className="flex min-h-[140px] flex-col border-b @[560px]:min-h-0 @[560px]:border-b-0 @[560px]:border-r">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
              <span className="text-xs font-semibold">Your result</span>
              <span className="text-[11px] text-muted-foreground">{statusCaption}</span>
              <div className="ml-auto flex items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  page
                  <select
                    value={rowLimit}
                    onChange={(e) => patchRowLimit(Number(e.target.value))}
                    className="h-6 rounded border bg-background px-1 font-mono text-[11px] text-foreground"
                    aria-label="rows per page"
                  >
                    {SQL_PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                    {!SQL_PAGE_SIZES.includes(rowLimit as (typeof SQL_PAGE_SIZES)[number]) && (
                      <option value={rowLimit}>{rowLimit}</option>
                    )}
                  </select>
                </label>
                <Button size="sm" className="h-7 gap-1.5 px-3" disabled={running} onClick={() => void run()}>
                  <Play className="size-3" /> Run
                  <span className="font-mono text-[10px] opacity-60">⌘↵</span>
                </Button>
              </div>
            </div>
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-auto pr-2"
              style={{ scrollbarGutter: "stable" }}
            >
              {error ? errorBox : renderResultTable(true)}
            </div>
          </div>

          {renderExpectedResult()}
        </div>
      </CardContent>

      {storeEnabled && (
        <>
          <StoredQueryPickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            projectId={projectId}
            onUseCopy={useStoredCopy}
            onLink={onLinkChange ? linkStored : undefined}
          />
          <SaveStoredQueryDialog
            open={saveOpen}
            onOpenChange={setSaveOpen}
            projectId={projectId}
            query={query}
            defaultName={name}
            existing={saveTarget}
            onSaved={(asset) => {
              // Storing a fresh copy from a linked editor re-links to the new
              // asset so "update" targets it from now on.
              if (onLinkChange && linked) onLinkChange(toLinkedQuery(asset));
            }}
          />
        </>
      )}
    </Card>
  );
};

export default SqlQueryEditor;
