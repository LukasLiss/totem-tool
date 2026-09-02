import { useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useFilterStack } from "@/contexts/FilterStackContext";
import { applyGlobalFilterRules } from "@/store/applyGlobalFilter";
import type { ProcessAreaSnapshot } from "@/store/processAreaStore";

import {
  activitiesForProcessAreaFilter,
  buildProcessAreaFilterRules,
  describeObjectTypes,
  PROCESS_AREA_FILTER_TYPES,
} from "./processAreaFilter";

export type ProcessAreaFilterActionProps = {
  fileId?: number | string | null;
  area: Pick<ProcessAreaSnapshot, "id" | "label" | "objectTypes" | "activities">;
  /** Whether the visualizer shows all activities ("detailed view"). */
  detailedView: boolean;
  objectTypeToActivities: Record<string, string[]>;
};

/**
 * The small filter circle that appears when hovering a process area.
 *
 * Clicking it opens a dialog that previews which object types and
 * activities would be kept and, on confirmation, overwrites the global
 * object-type and activity filters with them. The time-range filter is left
 * untouched. Rendered inside the area's container, which must carry the
 * `group/process-area` class so the circle can fade in on hover.
 */
export function ProcessAreaFilterAction({
  fileId,
  area,
  detailedView,
  objectTypeToActivities,
}: ProcessAreaFilterActionProps) {
  const { replaceFilters } = useFilterStack();
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const numericFileId = Number(fileId);
  const hasFile = Number.isFinite(numericFileId) && numericFileId > 0;

  const objectTypes = useMemo(
    () => [...area.objectTypes].sort((a, b) => a.localeCompare(b)),
    [area.objectTypes],
  );
  const activities = useMemo(
    () => activitiesForProcessAreaFilter(area, detailedView, objectTypeToActivities),
    [area, detailedView, objectTypeToActivities],
  );

  async function apply() {
    if (!hasFile) return;
    setApplying(true);
    try {
      const rules = replaceFilters(
        PROCESS_AREA_FILTER_TYPES,
        buildProcessAreaFilterRules(objectTypes, activities),
      );
      await applyGlobalFilterRules(numericFileId, rules);
      toast.success(`Global filter set to process area: ${describeObjectTypes(objectTypes)}`);
      setOpen(false);
    } catch (error) {
      console.error("[ProcessAreaFilterAction] failed to apply filter", error);
      toast.error("Could not apply the process-area filter.");
    } finally {
      setApplying(false);
    }
  }

  // Everything inside the area is wrapped by a full-size button that toggles
  // the drill-down; stop propagation so the circle does not trigger it and
  // the visualizer's pan handler ignores the click.
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          data-totem-control
          aria-label={`Set global filter from process area ${area.label}`}
          title="Set the global object-type and activity filter to this process area"
          onClick={stop}
          onPointerDown={stop}
          onMouseDown={stop}
          className="absolute -top-3 -right-3 z-[4] flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 shadow-sm opacity-0 transition-opacity hover:bg-slate-100 hover:text-blue-600 focus-visible:opacity-100 group-hover/process-area:opacity-100 data-[state=open]:opacity-100"
        >
          <Filter className="h-3.5 w-3.5" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-lg"
        onClick={stop}
        onPointerDown={stop}
        onMouseDown={stop}
        onWheel={stop}
      >
        <DialogHeader>
          <DialogTitle>Filter by process area</DialogTitle>
          <DialogDescription>
            Overwrite the global object-type and activity filters with the
            contents of the process area <strong>{area.label}</strong>. A time
            range filter, if any, is kept.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FilterPreviewSection
            title="Object types kept"
            items={objectTypes}
            emptyText="This area has no object types."
          />
          <FilterPreviewSection
            title="Activities kept"
            items={activities}
            emptyText="No activities belong to this area."
            hint={
              detailedView
                ? "Detailed view: every activity of these object types."
                : "Level-based view: activities that already belong to a lower process area are left out. Switch to the detailed view (all activities) to include them."
            }
          />
          {!hasFile ? (
            <p className="text-sm text-destructive">Select an event log first.</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={applying}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void apply()} disabled={!hasFile || applying || objectTypes.length === 0}>
            {applying ? "Applying…" : "Overwrite global filter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilterPreviewSection({
  title,
  items,
  emptyText,
  hint,
}: {
  title: string;
  items: string[];
  emptyText: string;
  hint?: string;
}) {
  return (
    <section>
      <h3 className="text-sm font-medium">
        {title} <span className="text-muted-foreground">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {items.map((item) => (
            <Badge key={item} variant="secondary" className="font-normal">
              {item}
            </Badge>
          ))}
        </div>
      )}
      {hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
    </section>
  );
}

export default ProcessAreaFilterAction;
