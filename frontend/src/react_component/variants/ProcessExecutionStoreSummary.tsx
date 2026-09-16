import { AlertTriangle, CheckCircle2, Database } from "lucide-react";

import type { StoredExecutionsResponse } from "./types";

/** What happened when process executions were written into the event log. */
export function ProcessExecutionStoreSummary({ result }: { result: StoredExecutionsResponse }) {
  const hasAmbiguous = result.ambiguous_event_count > 0;
  const columns = [result.execution_column, result.variant_column].filter(Boolean) as string[];

  return (
    <section
      role="status"
      aria-label="Stored process executions"
      className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30"
    >
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">
            Stored {result.execution_count.toLocaleString()} process execution
            {result.execution_count === 1 ? "" : "s"} in the event log
          </p>
          <p className="flex flex-wrap items-center gap-x-1 text-muted-foreground">
            <Database className="h-3.5 w-3.5" aria-hidden />
            Column{columns.length === 1 ? "" : "s"}:{" "}
            {columns.map((column) => (
              <code key={column} className="rounded bg-background px-1 py-0.5 text-xs">
                {column}
              </code>
            ))}
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-4">
            <Stat label="Events with an id" value={result.assigned_event_count} />
            <Stat label="Events in no execution" value={result.unassigned_event_count} />
            <Stat label="Events in several executions" value={result.ambiguous_event_count} />
            <Stat
              label="Variants"
              value={result.variant_count === null ? "not computed" : result.variant_count}
            />
          </dl>
          {hasAmbiguous ? (
            <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {result.ambiguous_event_count.toLocaleString()} event
                {result.ambiguous_event_count === 1 ? "" : "s"} belong to more than one
                execution and got no id. Use an extraction whose executions do not
                overlap (connected components or resource-aware) to assign every event.
              </span>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate">{label}</dt>
      <dd className="font-medium tabular-nums text-foreground">
        {typeof value === "number" ? value.toLocaleString() : value}
      </dd>
    </div>
  );
}

export default ProcessExecutionStoreSummary;
