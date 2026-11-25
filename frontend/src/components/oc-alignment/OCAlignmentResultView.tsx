import { AlertCircle, AlertTriangle, Info } from "lucide-react";

import type { OCAlignmentResponse } from "@/api/ocAlignmentApi";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { AlignmentGraph } from "./AlignmentGraph";

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

/** Which object types were ignored because the model does not contain them. */
export function IgnoredObjectTypesNotice({ result }: { result: OCAlignmentResponse }) {
  const { projection } = result;
  if (!projection.ignored_object_types.length) return null;
  const parts = projection.ignored_object_types.map(
    (type) => `${type} (${plural(projection.ignored_object_counts[type] ?? 0, "object")})`,
  );
  return (
    <div
      role="status"
      data-testid="oc-alignment-ignored-types"
      className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">
          Ignored object {projection.ignored_object_types.length === 1 ? "type" : "types"} not contained in the
          model: {parts.join(", ")}
        </p>
        <p className="mt-0.5 text-amber-800">
          Their objects were removed from the process execution before aligning (a model move has to use
          the same objects as the log).
          {projection.dropped_event_count
            ? ` ${plural(projection.dropped_event_count, "event")} referred only to such objects and ${projection.dropped_event_count === 1 ? "was" : "were"} left out.`
            : ""}
        </p>
      </div>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-3">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
      {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export interface OCAlignmentResultViewProps {
  result: OCAlignmentResponse;
  showSilentMoves: boolean;
  onShowSilentMovesChange?: (value: boolean) => void;
  compact?: boolean;
  graphHeight?: number | "fill";
}

export function OCAlignmentResultView({
  result,
  showSilentMoves,
  onShowSilentMovesChange,
  compact = false,
  graphHeight,
}: OCAlignmentResultViewProps) {
  const counts = result.move_counts;
  const found = result.status === "optimal" || result.status === "approximate";
  const exact = found && result.exact !== false;
  const deviations = result.deviations_by_activity.filter((row) => row.log + row.model > 0);
  const deviatingObjects = result.deviations_by_object.filter((row) => row.log + row.model > 0);

  return (
    <div
      className={`flex min-h-0 flex-col gap-4 ${graphHeight === "fill" ? "flex-1" : ""}`}
      data-testid="oc-alignment-result"
    >
      <IgnoredObjectTypesNotice result={result} />
      {result.unknown_activities.length ? (
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            Activities without a transition in the model (always log moves):{" "}
            {result.unknown_activities.join(", ")}
          </span>
        </div>
      ) : null}

      {!found ? (
        <div
          role="alert"
          className={`flex items-start gap-3 rounded-md border p-4 text-sm ${
            result.status === "no_alignment" || result.status === "empty_execution"
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-medium">
              {result.status === "no_alignment"
                ? "No alignment exists"
                : result.status === "empty_execution"
                  ? "Nothing to align"
                  : "Search stopped before the optimum was found"}
            </p>
            <p className="mt-1 opacity-90">{result.message}</p>
            {result.diagnostics?.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-4" data-testid="oc-alignment-diagnostics">
                {result.diagnostics.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            {result.status === "state_limit" || result.status === "timeout" ? (
              <p className="mt-1 opacity-90">
                Raise the state limit or the time limit, or pick a smaller process execution.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          {!exact ? (
            <div
              role="status"
              data-testid="oc-alignment-approximate"
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Approximate alignment — not guaranteed to be optimal</p>
                <p className="mt-0.5 text-amber-800">{result.message}</p>
                <p className="mt-0.5 text-amber-800">
                  For the optimal alignment raise the state or time limit, or pick a smaller process execution.
                </p>
              </div>
            </div>
          ) : null}
          <div className={`grid gap-2 ${compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-6"}`}>
            <Tile
              label={exact ? "Alignment cost" : "Alignment cost (upper bound)"}
              value={exact ? String(result.cost ?? 0) : `≤ ${result.cost ?? 0}`}
              hint={
                !exact
                  ? `optimum ≥ ${result.lower_bound ?? 0}`
                  : result.cost === 0
                    ? "Execution fits the model"
                    : "objects × deviating moves"
              }
              tone={result.cost === 0 ? "text-emerald-700" : "text-rose-700"}
            />
            <Tile label="Synchronous moves" value={counts.sync.toLocaleString()} />
            <Tile label="Log moves" value={counts.log.toLocaleString()} hint="in the log only" />
            <Tile label="Model moves" value={counts.model.toLocaleString()} hint="missing in the log" />
            {!compact ? (
              <Tile
                label="Synchronous events"
                value={
                  result.synchronous_event_ratio === null
                    ? "–"
                    : `${Math.round(result.synchronous_event_ratio * 100)}%`
                }
                hint={`of ${plural(result.execution.event_count, "event")}`}
              />
            ) : null}
            {!compact ? (
              <Tile
                label="Search"
                value={`${(result.elapsed_ms / 1000).toFixed(2)} s`}
                hint={`${result.states_explored.toLocaleString()} states explored`}
              />
            ) : null}
          </div>

          <div className={`flex min-h-0 flex-col gap-2 ${graphHeight === "fill" ? "flex-1" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Alignment of execution “{result.execution_id}” ({plural(result.execution.event_count, "event")},{" "}
                {plural(result.execution.object_count, "object")})
              </p>
              {onShowSilentMovesChange ? (
                <div className="flex items-center gap-2">
                  <Switch
                    id="oc-alignment-silent"
                    checked={showSilentMoves}
                    onCheckedChange={onShowSilentMovesChange}
                    disabled={counts.silent === 0}
                  />
                  <Label htmlFor="oc-alignment-silent" className="text-xs font-normal">
                    Show silent moves ({counts.silent})
                  </Label>
                </div>
              ) : null}
            </div>
            <AlignmentGraph
              moves={result.moves}
              objectsByType={result.execution.objects_by_type}
              showSilentMoves={showSilentMoves}
              height={graphHeight}
            />
          </div>

          {!compact && (deviations.length > 0 || deviatingObjects.length > 0) ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <DeviationTable
                title="Deviations by activity"
                head={["Activity", "Sync", "Log moves", "Model moves"]}
                rows={deviations.map((r) => [r.activity, r.sync, r.log, r.model])}
              />
              <DeviationTable
                title="Deviations by object"
                head={["Object", "Sync", "Log moves", "Model moves"]}
                rows={deviatingObjects.map((r) => [`${r.object_id} (${r.object_type})`, r.sync, r.log, r.model])}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function DeviationTable({ title, head, rows }: { title: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-sm font-medium">{title}</p>
      <div className="max-h-56 overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground">
            <tr>
              {head.map((h, i) => (
                <th key={h} className={`px-3 py-1.5 font-medium ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row[0])} className="border-t">
                {row.map((cell, i) => (
                  <td key={i} className={`px-3 py-1.5 ${i === 0 ? "max-w-[260px] truncate" : "text-right tabular-nums"}`}>
                    {typeof cell === "number" ? cell.toLocaleString() : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
