import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, ChevronRight } from "lucide-react";

import type { OCAlignmentBatchResponse, OCAlignmentBatchRow, OCAlignmentBatchStatus } from "@/api/ocAlignmentApi";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_LABELS: Record<OCAlignmentBatchStatus, string> = {
  optimal: "Optimal",
  approximate: "Approximate",
  no_alignment: "No alignment",
  state_limit: "State limit",
  timeout: "Time limit",
  empty_execution: "Nothing to align",
  skipped: "Skipped",
};

const STATUS_TONES: Record<OCAlignmentBatchStatus, string> = {
  optimal: "text-emerald-700",
  approximate: "text-amber-700",
  no_alignment: "text-destructive",
  state_limit: "text-amber-700",
  timeout: "text-amber-700",
  empty_execution: "text-muted-foreground",
  skipped: "text-muted-foreground",
};

function percent(value: number | null) {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-3">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

type SortKey = "cost" | "deviations" | "events" | "start";

export interface OCAlignmentBatchViewProps {
  result: OCAlignmentBatchResponse;
  /** Open the detailed alignment of one execution. */
  onOpenExecution?: (executionId: string) => void;
  selectedExecutionId?: string;
  compact?: boolean;
}

/** Summary of the alignments of all process executions of a source. */
export function OCAlignmentBatchView({ result, onOpenExecution, selectedExecutionId, compact = false }: OCAlignmentBatchViewProps) {
  const [sort, setSort] = useState<SortKey>("cost");
  const rows = useMemo(() => {
    const value = (row: OCAlignmentBatchRow) => {
      if (sort === "events") return -row.event_count;
      if (sort === "start") return row.start_unix ?? 0;
      if (row.cost === null) return Number.NEGATIVE_INFINITY; // failures first
      return sort === "cost" ? -row.cost : -((row.move_counts?.log ?? 0) + (row.move_counts?.model ?? 0));
    };
    return [...result.rows].sort((a, b) => value(a) - value(b) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [result.rows, sort]);
  const failures = result.rows.filter((r) => r.status === "no_alignment");
  const limited = (result.status_counts.state_limit ?? 0) + (result.status_counts.timeout ?? 0);
  const ignored = Object.entries(result.ignored_object_types);
  const deviations = result.deviations_by_activity.filter((r) => r.log + r.model > 0);
  // The same reason for every failing execution is the common case (a model problem).
  const firstDiagnostics = failures[0]?.diagnostics ?? [];

  return (
    <div className="flex flex-col gap-4" data-testid="oc-alignment-batch">
      {ignored.length ? (
        <div role="status" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Ignored object types not contained in the model:{" "}
            {ignored.map(([type, n]) => `${type} (in ${n.toLocaleString()} executions)`).join(", ")}. Their objects were
            removed before aligning.
          </span>
        </div>
      ) : null}
      {failures.length ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">
              No alignment exists for {failures.length.toLocaleString()} of {result.total.toLocaleString()} executions
            </p>
            {firstDiagnostics.length ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 opacity-90">
                {firstDiagnostics.map((d) => <li key={d}>{d}</li>)}
              </ul>
            ) : null}
            {failures.length > 1 ? (
              <p className="mt-1 opacity-80">Shown for “{failures[0].id}”; open an execution for its own reasons.</p>
            ) : null}
          </div>
        </div>
      ) : null}
      {limited || result.stopped_early ? (
        <p className="text-xs text-muted-foreground">
          {limited ? `${limited.toLocaleString()} executions hit the per-execution limits (${result.max_states.toLocaleString()} states, ${result.timeout_s} s). ` : ""}
          {result.stopped_early
            ? `The batch stopped after its total time limit of ${result.total_timeout_s} s; ${(result.status_counts.skipped ?? 0).toLocaleString()} executions were skipped.`
            : ""}
        </p>
      ) : null}

      <div className={`grid gap-2 ${compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-6"}`}>
        <Tile label="Aligned executions" value={`${result.aligned.toLocaleString()} / ${result.total.toLocaleString()}`}
          hint={result.exact < result.aligned ? `${(result.aligned - result.exact).toLocaleString()} approximate` : "all optimal"} />
        <Tile label="Fitting executions" value={result.fitting.toLocaleString()}
          hint={result.aligned ? `${percent(result.fitting / result.aligned)} of aligned (cost 0)` : undefined} />
        <Tile label="Average cost" value={result.average_cost === null ? "–" : result.average_cost.toFixed(2)} hint="per aligned execution" />
        <Tile label="Synchronous events" value={percent(result.synchronous_event_ratio)} hint="over all aligned events" />
        {!compact ? <Tile label="Cost per event" value={result.cost_per_event === null ? "–" : result.cost_per_event.toFixed(3)} /> : null}
        {!compact ? <Tile label="Time" value={`${(result.elapsed_ms / 1000).toFixed(1)} s`} /> : null}
      </div>

      <div className={`grid gap-4 ${compact ? "" : "lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"}`}>
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-medium">Deviations by activity (all executions)</p>
          <div className="max-h-80 overflow-auto rounded-md border">
            {deviations.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No deviations in the aligned executions.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Activity</th>
                    <th className="px-2 py-1.5 text-right font-medium">Log moves</th>
                    <th className="px-2 py-1.5 text-right font-medium">Model moves</th>
                    <th className="px-2 py-1.5 text-right font-medium">Executions</th>
                  </tr>
                </thead>
                <tbody>
                  {deviations.map((r) => (
                    <tr key={r.activity} className="border-t">
                      <td className="max-w-[200px] truncate px-3 py-1.5" title={r.activity}>{r.activity}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.log.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.model.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.executions.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Executions{onOpenExecution ? " — click one for its alignment" : ""}</p>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger aria-label="Sort aligned executions" className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cost">Sort: highest cost</SelectItem>
                <SelectItem value="deviations">Sort: most deviations</SelectItem>
                <SelectItem value="events">Sort: most events</SelectItem>
                <SelectItem value="start">Sort: start time</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-80 overflow-auto rounded-md border" role="listbox" aria-label="Aligned executions">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Execution</th>
                  <th className="px-2 py-1.5 text-left font-medium">Status</th>
                  <th className="px-2 py-1.5 text-right font-medium">Cost</th>
                  <th className="px-2 py-1.5 text-right font-medium">Log / model moves</th>
                  {!compact ? <th className="px-2 py-1.5 text-right font-medium">Events</th> : null}
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    role="option"
                    aria-selected={row.id === selectedExecutionId}
                    tabIndex={onOpenExecution ? 0 : -1}
                    title={row.diagnostics?.join("\n") || row.message || undefined}
                    onClick={() => onOpenExecution?.(row.id)}
                    onKeyDown={(e) => {
                      if (onOpenExecution && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        onOpenExecution(row.id);
                      }
                    }}
                    className={`border-t ${onOpenExecution ? "cursor-pointer hover:bg-muted/60" : ""} ${
                      row.id === selectedExecutionId ? "bg-primary/10 font-medium" : ""
                    }`}
                  >
                    <td className="max-w-[200px] truncate px-3 py-1.5" title={row.id}>{row.id}</td>
                    <td className={`whitespace-nowrap px-2 py-1.5 text-xs ${STATUS_TONES[row.status]}`}>{STATUS_LABELS[row.status]}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {row.cost === null ? "–" : row.exact ? row.cost : `≤ ${row.cost}`}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {row.move_counts ? `${row.move_counts.log} / ${row.move_counts.model}` : "–"}
                    </td>
                    {!compact ? <td className="px-2 py-1.5 text-right tabular-nums">{row.event_count}</td> : null}
                    <td className="pr-2 text-muted-foreground">{onOpenExecution ? <ChevronRight className="size-4" /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
