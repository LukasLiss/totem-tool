import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type {
  OCCNReplayStatus,
  OCCNReplayUnitResult,
} from "@/api/occnConformanceApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { OCCN_REPLAY_STATUS_LABELS } from "./conformancePresentation";

const PAGE_SIZE = 25;
const ALL_STATUSES = "all" as const;
type StatusFilter = OCCNReplayStatus | typeof ALL_STATUSES;

export interface OccnReplayUnitExplorerProps {
  units: OCCNReplayUnitResult[];
  onSelectUnit?: (unit: OCCNReplayUnitResult) => void;
}

export function OccnReplayUnitExplorer({
  units,
  onSelectUnit,
}: OccnReplayUnitExplorerProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL_STATUSES);
  const [page, setPage] = useState(1);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  const filteredUnits = useMemo(
    () =>
      statusFilter === ALL_STATUSES
        ? units
        : units.filter((unit) => unit.status === statusFilter),
    [statusFilter, units]
  );
  const pageCount = Math.max(1, Math.ceil(filteredUnits.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleUnits = filteredUnits.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  useEffect(() => {
    if (
      selectedUnitId !== null &&
      !units.some((unit) => unit.unit_id === selectedUnitId)
    ) {
      setSelectedUnitId(null);
    }
  }, [selectedUnitId, units]);

  function changeFilter(value: StatusFilter) {
    setStatusFilter(value);
    setPage(1);
  }

  function selectUnit(unit: OCCNReplayUnitResult) {
    setSelectedUnitId(unit.unit_id);
    onSelectUnit?.(unit);
  }

  const firstVisible = filteredUnits.length === 0 ? 0 : pageStart + 1;
  const lastVisible = Math.min(pageStart + PAGE_SIZE, filteredUnits.length);

  return (
    <section
      aria-labelledby="occn-replay-units-title"
      className="overflow-hidden rounded-md border bg-background"
    >
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="occn-replay-units-title" className="text-sm font-semibold">
            Replay units
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Connected event-object components checked against the selected model.
          </p>
        </div>
        <div className="w-full sm:w-48">
          <Label htmlFor="occn-unit-status-filter" className="sr-only">
            Filter replay units by status
          </Label>
          <Select
            value={statusFilter}
            onValueChange={(value) => changeFilter(value as StatusFilter)}
          >
            <SelectTrigger
              id="occn-unit-status-filter"
              size="sm"
              aria-label="Filter replay units by status"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
              <SelectItem value="fitting">Fitting</SelectItem>
              <SelectItem value="non_fitting">Non-fitting</SelectItem>
              <SelectItem value="inconclusive">Inconclusive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[32%]">Replay unit</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Events</TableHead>
            <TableHead className="w-[28%]">Object types</TableHead>
            <TableHead className="text-right">Explored states</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleUnits.length > 0 ? (
            visibleUnits.map((unit) => {
              const selected = unit.unit_id === selectedUnitId;
              return (
                <TableRow
                  key={unit.unit_id}
                  data-state={selected ? "selected" : undefined}
                  aria-selected={selected}
                >
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-pressed={selected}
                      className="h-auto max-w-full justify-start whitespace-normal px-1 py-1 text-left font-mono text-xs"
                      onClick={() => selectUnit(unit)}
                    >
                      <span className="break-all">{unit.unit_id}</span>
                    </Button>
                  </TableCell>
                  <TableCell>
                    <ReplayStatusBadge status={unit.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {unit.event_count.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <span
                      className="block max-w-72 truncate"
                      title={formatObjectTypes(unit.object_types)}
                    >
                      {formatObjectTypes(unit.object_types)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {unit.explored_state_count.toLocaleString()}
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell
                colSpan={5}
                className="h-24 text-center text-muted-foreground"
              >
                No replay units match this status.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Showing {firstVisible}-{lastVisible} of {filteredUnits.length.toLocaleString()}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            Page {currentPage} of {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Previous replay-unit page"
            title="Previous page"
            disabled={currentPage === 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Next replay-unit page"
            title="Next page"
            disabled={currentPage === pageCount}
            onClick={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </section>
  );
}

function ReplayStatusBadge({ status }: { status: OCCNReplayStatus }) {
  const styles: Record<OCCNReplayStatus, string> = {
    fitting:
      "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
    non_fitting:
      "border-destructive/40 bg-destructive/10 text-destructive dark:text-red-300",
    inconclusive:
      "border-amber-600/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  };

  return (
    <Badge variant="outline" className={cn(styles[status])}>
      {OCCN_REPLAY_STATUS_LABELS[status]}
    </Badge>
  );
}

function formatObjectTypes(objectTypes: string[]): string {
  return objectTypes.length > 0 ? objectTypes.join(", ") : "None";
}

export default OccnReplayUnitExplorer;
