/**
 * Browse the example query library and add examples (with their
 * dependencies) to the project's query store. Examples that need a
 * log-specific column ask for it before they are stored.
 */

import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  createQueryAsset,
  extractAssetApiError,
  type ProjectAsset,
} from "@/api/assetsApi";
import { getQueryColumns, type TableSchema } from "@/api/queryApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  EXAMPLE_GROUPS,
  EXAMPLE_QUERIES,
  collectParams,
  missingPlaceholders,
  renderExampleSql,
  withDependencies,
  type ExampleParam,
} from "./exampleQueries";
import { SqlHighlightedTextarea } from "./SqlHighlightedTextarea";

const FIXED_COLUMNS: Record<ExampleParam["table"], string[]> = {
  events: ["event_id", "activity", "timestamp_unix"],
  objects: ["obj_id", "obj_type"],
};

export interface ExampleQueriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: number;
  fileId?: number;
  /** names already stored in the project (dependencies with these names are reused) */
  existingNames: string[];
  onAdded?: (created: ProjectAsset[]) => void | Promise<void>;
}

export function ExampleQueriesDialog({
  open,
  onOpenChange,
  projectId,
  fileId,
  existingNames,
  onAdded,
}: ExampleQueriesDialogProps) {
  const [selectedId, setSelectedId] = useState(EXAMPLE_QUERIES[0].id);
  const [schema, setSchema] = useState<TableSchema[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => EXAMPLE_QUERIES.find((q) => q.id === selectedId) ?? EXAMPLE_QUERIES[0],
    [selectedId]
  );
  const params = useMemo(() => collectParams(selected), [selected]);
  const chain = useMemo(() => withDependencies(selected), [selected]);
  const existing = useMemo(() => new Set(existingNames), [existingNames]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!fileId) {
      setSchema([]);
      return;
    }
    let alive = true;
    getQueryColumns(fileId)
      .then((tables) => {
        if (alive) setSchema(tables);
      })
      .catch(() => {
        if (alive) setSchema([]);
      });
    return () => {
      alive = false;
    };
  }, [open, fileId]);

  const columnsFor = (table: ExampleParam["table"]) => {
    const all = schema.find((t) => t.name === table)?.columns.map((c) => c.name) ?? [];
    const fixed = FIXED_COLUMNS[table];
    // derived / attribute columns first: those are what the examples ask for
    return [...all.filter((c) => !fixed.includes(c)), ...all.filter((c) => fixed.includes(c))];
  };

  const missing = params.filter((p) => !values[p.key]);
  const previewSql = renderExampleSql(selected.sql, values);

  const uniqueName = (name: string, taken: Set<string>) => {
    if (!taken.has(name)) return name;
    let i = 2;
    while (taken.has(`${name} (${i})`)) i += 1;
    return `${name} (${i})`;
  };

  const handleAdd = async () => {
    if (!projectId) {
      setError("Select an event log first.");
      return;
    }
    if (missing.length > 0) {
      setError(`Select ${missing.map((p) => p.label.toLowerCase()).join(" and ")} first.`);
      return;
    }
    setAdding(true);
    setError(null);
    const taken = new Set(existing);
    const created: ProjectAsset[] = [];
    try {
      for (const q of chain) {
        const isTarget = q.id === selected.id;
        // Dependencies already present by name are reused (their content may
        // differ if the user edited them); the selected example always gets
        // its own, uniquely named copy.
        if (!isTarget && taken.has(q.name)) continue;
        const sql = renderExampleSql(q.sql, values);
        const unresolved = missingPlaceholders(sql);
        if (unresolved.length) {
          throw new Error(`Missing selection for ${unresolved.join(", ")}.`);
        }
        const name = isTarget ? uniqueName(q.name, taken) : q.name;
        const asset = await createQueryAsset({
          projectId,
          name,
          query: sql,
          description: q.description,
        });
        taken.add(name);
        created.push(asset);
      }
      toast.success(
        created.length === 1
          ? `Added "${created[0].name}"`
          : `Added ${created.length} queries (${created.map((a) => a.name).join(", ")})`
      );
      await onAdded?.(created);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error && !("isAxiosError" in err) ? err.message : extractAssetApiError(err).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] flex-col gap-3 p-4 sm:max-w-[min(1200px,94vw)]">
        <DialogHeader className="shrink-0">
          <DialogTitle>Example queries</DialogTitle>
          <DialogDescription>
            Ready-made queries for object-centric process analysis. Adding one stores it in
            this project's query store (together with the queries it builds on) so you can
            run, edit, link and reuse it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
          {/* library list */}
          <div className="min-h-0 overflow-y-auto rounded-md border">
            {EXAMPLE_GROUPS.map((group) => {
              const items = EXAMPLE_QUERIES.filter((q) => q.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  <p className="sticky top-0 border-b bg-muted/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                    {group}
                  </p>
                  <ul>
                    {items.map((q) => {
                      const active = q.id === selected.id;
                      return (
                        <li key={q.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(q.id)}
                            className={cn(
                              "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
                              active && "bg-accent"
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{q.name}</span>
                              {q.params?.length ? (
                                <span className="block text-[11px] text-muted-foreground">
                                  needs a column selection
                                </span>
                              ) : null}
                            </span>
                            {existing.has(q.name) && (
                              <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-label="already in project" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>

          {/* details */}
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            <div>
              <h3 className="text-base font-semibold">{selected.name}</h3>
              <p className="text-sm text-muted-foreground">{selected.description}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-[10px]">{selected.group}</Badge>
                {selected.shape && (
                  <Badge variant="secondary" className="text-[10px]">{selected.shape}</Badge>
                )}
                {existing.has(selected.name) && (
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    <Check className="size-3" /> already in project — a copy will be added
                  </Badge>
                )}
              </div>
            </div>

            {chain.length > 1 && (
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Builds on{" "}
                {chain
                  .filter((q) => q.id !== selected.id)
                  .map((q) => (
                    <span key={q.id} className="font-medium text-foreground">
                      "{q.name}"{existing.has(q.name) ? " (already in project)" : ""}
                    </span>
                  ))
                  .reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}
                . Missing ones are added as well; the query references them by name.
              </p>
            )}

            {params.length > 0 && (
              <div className="grid gap-3 rounded-md border p-3 md:grid-cols-2">
                {params.map((p) => {
                  const columns = columnsFor(p.table);
                  return (
                    <div key={p.key} className="grid gap-1.5">
                      <Label htmlFor={`example-param-${p.key}`}>{p.label}</Label>
                      <Select
                        value={values[p.key] ?? ""}
                        onValueChange={(v) => setValues((prev) => ({ ...prev, [p.key]: v }))}
                        disabled={!fileId || columns.length === 0}
                      >
                        <SelectTrigger id={`example-param-${p.key}`} className="w-full">
                          <SelectValue
                            placeholder={
                              !fileId
                                ? "select an event log first"
                                : columns.length === 0
                                  ? `no columns on ${p.table}`
                                  : `column of ${p.table}`
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {columns.map((c) => (
                            <SelectItem key={c} value={c} className="font-mono text-xs">
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">{p.description}</p>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="min-h-[160px] flex-1 rounded-md border bg-[hsl(240,20%,99%)]">
              <SqlHighlightedTextarea value={previewSql} readOnly className="h-full min-h-[160px]" />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="size-4" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={adding}>
            Close
          </Button>
          <Button type="button" onClick={handleAdd} disabled={adding || !projectId}>
            <Plus className="size-4" />
            {adding ? "Adding" : chain.length > 1 ? `Add to project (${chain.length} queries)` : "Add to project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ExampleQueriesDialog;
