/**
 * Components shared by the SQL-driven dashboard widgets (KPI, bar chart,
 * scatter plot, pie chart): the edit-mode query section with column
 * discovery, column inputs, and view-mode status placeholders. Non-component
 * helpers live in sqlWidgetUtils.ts.
 */

import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ExpectedResult } from "@/react_component/SqlQueryEditor";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { SqlQueryField } from "@/react_component/sql/SqlQueryField";
import { cn } from "@/lib/utils";
import type { ColumnDiscovery } from "./sqlWidgetUtils";

/* ------------------------------------------------------------------ */
/* Edit-mode pieces                                                    */
/* ------------------------------------------------------------------ */

export function QuerySection({
  widgetId,
  query,
  onQueryChange,
  linkedQuery,
  onLinkChange,
  fileId,
  projectId,
  expectedResult,
  editorTitle,
  discovery,
  growQuery = false,
  className,
}: {
  widgetId: number;
  query: string;
  onQueryChange: (q: string) => void;
  linkedQuery: LinkedQuery | null;
  onLinkChange: (l: LinkedQuery | null) => void;
  fileId?: number;
  projectId?: number;
  expectedResult: ExpectedResult;
  editorTitle: string;
  discovery: ColumnDiscovery;
  /** let the query box grow to the whole query (see SqlQueryField `grow`) */
  growQuery?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor={`sql-widget-query-${widgetId}`}>SQL query</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => void discovery.discover()}
          disabled={discovery.loading}
        >
          <RefreshCw className={cn("size-3", discovery.loading && "animate-spin")} />
          Detect columns
        </Button>
      </div>
      <SqlQueryField
        id={`sql-widget-query-${widgetId}`}
        value={query}
        onChange={onQueryChange}
        linkedQuery={linkedQuery}
        onLinkChange={onLinkChange}
        fileId={fileId}
        projectId={projectId}
        expectedResult={expectedResult}
        editorTitle={editorTitle}
        grow={growQuery}
      />
      {expectedResult.description && (
        <p className="text-xs text-muted-foreground">{expectedResult.description}</p>
      )}
      {discovery.error && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="size-3.5" /> {discovery.error}
        </p>
      )}
      {discovery.columns.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Columns: <span className="font-mono">{discovery.columns.join(", ")}</span>
        </p>
      )}
    </div>
  );
}

export function ColumnInput({
  id,
  label,
  value,
  onChange,
  columns,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  columns: string[];
  placeholder?: string;
  hint?: string;
}) {
  const listId = `${id}-columns`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        list={columns.length ? listId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? (columns[0] ? `e.g. ${columns[0]}` : "column name")}
        className="font-mono text-xs"
      />
      {columns.length > 0 && (
        <datalist id={listId}>
          {columns.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      )}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A row of mutually exclusive options drawn as one connected strip. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex rounded-md border bg-muted/40 p-0.5", disabled && "opacity-50")}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* View-mode pieces                                                    */
/* ------------------------------------------------------------------ */

/**
 * A chart widget's title above the chart: the same size for every chart,
 * cut off with an ellipsis when too long (the full title shows on hover).
 * Renders nothing without a title.
 */
export function ChartTitle({ title }: { title: string }) {
  if (!title) return null;
  return (
    <CardHeader className="pb-0 text-center">
      <CardTitle className="truncate text-base" title={title}>
        {title}
      </CardTitle>
    </CardHeader>
  );
}

export function WidgetMessage({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <Card className="flex h-full w-full items-center justify-center rounded-none p-4">
      <p
        className={cn(
          "text-center text-sm",
          tone === "error" ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {children}
      </p>
    </Card>
  );
}
