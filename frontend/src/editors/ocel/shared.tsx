import { ReactNode, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Sort state shared by the three editor tables. */
export type Sort = { by: string; dir: "asc" | "desc" };

export function toggleSort(sort: Sort, column: string): Sort {
  if (sort.by !== column) return { by: column, dir: "asc" };
  return { by: column, dir: sort.dir === "asc" ? "desc" : "asc" };
}

export function SortableHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: string;
  sort: Sort;
  onSort: (column: string) => void;
}) {
  const active = sort.by === column;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      className="flex items-center gap-1 font-medium hover:text-foreground"
      onClick={() => onSort(column)}
    >
      {label}
      <Icon className={`size-3.5 ${active ? "" : "opacity-40"}`} />
    </button>
  );
}

/** Debounce a rapidly changing value (search inputs). */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

export function PaginationFooter({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          aria-label="Rows per page"
        >
          {[25, 50, 100, 250].map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className="tabular-nums">
          {page} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

/** Unix seconds → value for <input type="datetime-local"> in local time. */
export function unixToLocalInput(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value → unix seconds (local time). */
export function localInputToUnix(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

export function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type AttributeRow = { key: string; value: string };

export function attributesToRows(attributes: Record<string, string>): AttributeRow[] {
  return Object.entries(attributes).map(([key, value]) => ({ key, value }));
}

export function rowsToAttributes(rows: AttributeRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) result[row.key.trim()] = row.value;
  }
  return result;
}

/**
 * Key/value editor for event and object attributes. Attribute values are
 * rarely edited, so this stays compact: one row per attribute plus an
 * "add attribute" button.
 */
export function AttributeEditor({
  rows,
  onChange,
  knownKeys = [],
  idPrefix,
}: {
  rows: AttributeRow[];
  onChange: (rows: AttributeRow[]) => void;
  knownKeys?: string[];
  idPrefix: string;
}) {
  const listId = `${idPrefix}-attr-keys`;
  return (
    <div className="flex flex-col gap-1.5">
      <datalist id={listId}>
        {knownKeys.map((key) => (
          <option key={key} value={key} />
        ))}
      </datalist>
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            value={row.key}
            list={listId}
            placeholder="attribute"
            aria-label="Attribute name"
            className="h-8 flex-1"
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, key: event.target.value };
              onChange(next);
            }}
          />
          <Input
            value={row.value}
            placeholder="value"
            aria-label="Attribute value"
            className="h-8 flex-1"
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, value: event.target.value };
              onChange(next);
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            aria-label="Remove attribute"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="h-8 self-start"
        onClick={() => onChange([...rows, { key: "", value: "" }])}
      >
        <Plus className="size-4" /> Add attribute
      </Button>
    </div>
  );
}

export const tableWrapClass =
  "flex-1 min-h-0 overflow-auto";
export const tableClass = "w-full border-collapse text-sm";
export const theadClass =
  "sticky top-0 z-10 bg-background text-left text-xs uppercase tracking-wide text-muted-foreground";
export const thClass = "border-b px-3 py-2 font-medium whitespace-nowrap";
export const tdClass = "border-b px-3 py-1.5 align-middle";
