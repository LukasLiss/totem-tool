import type { ReactNode } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";

import type {
  OCCNReplayUnitDetailEvent,
  OCCNReplayUnitResult,
} from "@/api/occnConformanceApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { OccnReplayStatusBadge } from "./OccnReplayUnitExplorer";
import type { OccnReplayUnitDetailState } from "./useOccnReplayUnitDetail";

export interface OccnReplayUnitDetailProps {
  unit: OCCNReplayUnitResult;
  detailState: OccnReplayUnitDetailState;
}

export function OccnReplayUnitDetail({
  unit,
  detailState,
}: OccnReplayUnitDetailProps) {
  const { detail, loading, error } = detailState;

  return (
    <section
      aria-labelledby="occn-replay-unit-detail-title"
      aria-busy={loading}
      className="overflow-hidden rounded-md border bg-background"
    >
      <header className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2
            id="occn-replay-unit-detail-title"
            className="text-sm font-semibold"
          >
            Replay unit detail
          </h2>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {unit.unit_id}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <OccnReplayStatusBadge status={unit.status} />
          <Badge variant="secondary" className="tabular-nums">
            {unit.event_count.toLocaleString()} events
          </Badge>
        </div>
      </header>

      <dl className="grid border-b xl:grid-cols-4">
        <ReplayMetadata label="Replayable" value={replayableLabel(unit)} />
        <ReplayMetadata
          label="Explored states"
          value={unit.explored_state_count.toLocaleString()}
        />
        <ReplayMetadata
          label="Failure position"
          value={failurePositionLabel(unit)}
        />
        <div className="min-w-0 border-t px-4 py-3 xl:border-l xl:border-t-0">
          <dt className="text-xs font-medium text-muted-foreground">
            Object types
          </dt>
          <dd className="mt-2 flex flex-wrap gap-1.5">
            {unit.object_types.length > 0 ? (
              unit.object_types.map((objectType) => (
                <Badge key={objectType} variant="outline">
                  {objectType}
                </Badge>
              ))
            ) : (
              <span className="text-sm">None</span>
            )}
          </dd>
        </div>
      </dl>

      <ReplayDiagnostic unit={unit} />

      {loading ? (
        <DetailMessage
          icon={<LoaderCircle className="animate-spin" />}
          title="Loading replay events"
        />
      ) : error ? (
        <DetailError message={error} onRetry={detailState.retry} />
      ) : detail ? (
        <ReplayEventPage
          unit={unit}
          detail={detail}
          onPrevious={detailState.previousPage}
          onNext={detailState.nextPage}
        />
      ) : (
        <DetailMessage
          icon={<AlertCircle />}
          title="Replay event details are unavailable"
        />
      )}
    </section>
  );
}

function ReplayMetadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-t px-4 py-3 first:border-t-0 xl:border-l xl:border-t-0 xl:first:border-l-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function ReplayDiagnostic({ unit }: { unit: OCCNReplayUnitResult }) {
  if (unit.failure_event_index !== null) {
    return (
      <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-3">
        <p className="text-xs font-medium text-destructive">
          First failing event
        </p>
        <p className="mt-1 text-sm">
          Event {unit.failure_event_index + 1} of{" "}
          {unit.event_count.toLocaleString()}
          {unit.failure_event_id ? (
            <span className="font-mono"> / {unit.failure_event_id}</span>
          ) : null}
        </p>
      </div>
    );
  }

  if (unit.status === "non_fitting") {
    return (
      <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-3">
        <p className="text-xs font-medium text-destructive">
          No specific failure event identified
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          The complete replay unit is non-fitting, but no individual event was
          identified as the failure point.
        </p>
      </div>
    );
  }

  if (unit.status === "inconclusive") {
    return (
      <div className="border-b border-amber-600/30 bg-amber-500/5 px-4 py-3">
        <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
          Replay result inconclusive
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {limitReasonLabel(unit.limit_reason)}
        </p>
      </div>
    );
  }

  return null;
}

function ReplayEventPage({
  unit,
  detail,
  onPrevious,
  onNext,
}: {
  unit: OCCNReplayUnitResult;
  detail: NonNullable<OccnReplayUnitDetailState["detail"]>;
  onPrevious: OccnReplayUnitDetailState["previousPage"];
  onNext: OccnReplayUnitDetailState["nextPage"];
}) {
  const { pagination, events } = detail;
  const firstEvent = events.length > 0 ? pagination.offset + 1 : 0;
  const lastEvent =
    events.length > 0 ? pagination.offset + pagination.returned_count : 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Event sequence</h3>
        <p
          className="text-xs tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          Showing {firstEvent}-{lastEvent} of{" "}
          {pagination.total_count.toLocaleString()}
        </p>
      </div>

      {events.length > 0 ? (
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-20 text-right">Position</TableHead>
                <TableHead className="w-52">Timestamp</TableHead>
                <TableHead className="w-[28%]">Activity</TableHead>
                <TableHead>Objects</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <ReplayEventRow
                  key={`${event.event_index}:${event.event_id}`}
                  event={event}
                  failureEventIndex={unit.failure_event_index}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <DetailMessage
          icon={<AlertCircle />}
          title="No replay events on this page"
        />
      )}

      <div
        className="flex items-center justify-end gap-2 border-t px-4 py-3"
        aria-label="Replay event pagination"
      >
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Previous replay-event page"
          title="Previous page"
          disabled={!pagination.has_previous}
          onClick={() => void onPrevious()}
        >
          <ChevronLeft />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Next replay-event page"
          title="Next page"
          disabled={!pagination.has_next}
          onClick={() => void onNext()}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

function ReplayEventRow({
  event,
  failureEventIndex,
}: {
  event: OCCNReplayUnitDetailEvent;
  failureEventIndex: number | null;
}) {
  const failurePoint = event.event_index === failureEventIndex;
  const timestamp = replayEventTimestamp(event.timestamp_unix);

  return (
    <TableRow className={cn(failurePoint && "bg-destructive/5")}>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {event.event_index + 1}
      </TableCell>
      <TableCell>
        <time
          dateTime={timestamp.iso}
          title={`Unix timestamp: ${event.timestamp_unix}`}
          className="whitespace-nowrap text-xs tabular-nums"
        >
          {timestamp.label}
        </time>
      </TableCell>
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          <span className="break-words text-sm font-medium">
            {event.activity}
          </span>
          {failurePoint ? (
            <Badge variant="destructive" className="shrink-0">
              Failure point
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
          {event.event_id}
        </p>
      </TableCell>
      <TableCell>
        <ReplayEventObjects objectsByType={event.objects_by_type} />
      </TableCell>
    </TableRow>
  );
}

function ReplayEventObjects({
  objectsByType,
}: {
  objectsByType: Record<string, string[]>;
}) {
  const entries = Object.entries(objectsByType).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  if (entries.length === 0) {
    return <span className="text-sm text-muted-foreground">None</span>;
  }

  return (
    <div className="grid gap-1.5">
      {entries.map(([objectType, objectIds]) => (
        <div key={objectType} className="flex min-w-0 items-start gap-2">
          <Badge variant="outline" className="shrink-0">
            {objectType}
          </Badge>
          <span className="break-all font-mono text-xs leading-5">
            {objectIds.join(", ")}
          </span>
        </div>
      ))}
    </div>
  );
}

function DetailError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: OccnReplayUnitDetailState["retry"];
}) {
  return (
    <div role="alert" className="flex min-h-40 items-center justify-center p-6">
      <div className="max-w-lg text-center">
        <AlertCircle className="mx-auto size-5 text-destructive" />
        <p className="mt-3 text-sm font-medium">
          Replay event details could not be loaded
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => void onRetry()}
        >
          <RotateCcw />
          Retry
        </Button>
      </div>
    </div>
  );
}

function DetailMessage({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div
      role="status"
      className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground [&_svg]:size-5"
    >
      {icon}
      <p className="text-sm">{title}</p>
    </div>
  );
}

function replayableLabel(unit: OCCNReplayUnitResult): string {
  if (unit.replayable === null) return "Not determined";
  return unit.replayable ? "Yes" : "No";
}

function failurePositionLabel(unit: OCCNReplayUnitResult): string {
  return unit.failure_event_index === null
    ? "Not available"
    : `${unit.failure_event_index + 1} of ${unit.event_count.toLocaleString()}`;
}

function limitReasonLabel(reason: string | null): string {
  if (reason === "max_states") {
    return "The state exploration limit was reached before a result could be proven.";
  }
  return reason
    ? `Search stopped before a result could be proven: ${reason}.`
    : "No additional limit reason is available.";
}

function replayEventTimestamp(timestampUnix: number): {
  iso: string;
  label: string;
} {
  const date = new Date(timestampUnix * 1000);
  if (Number.isNaN(date.getTime())) {
    return {
      iso: "",
      label: timestampUnix.toLocaleString(),
    };
  }

  return {
    iso: date.toISOString(),
    label: new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(date),
  };
}

export default OccnReplayUnitDetail;
