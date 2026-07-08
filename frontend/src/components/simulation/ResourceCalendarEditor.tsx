import React, { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { CalendarProbability } from "@/api/simulationApi";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const CHART_BLUE = "var(--chart-2, #2d62ef)";
const EMPTY_CELL = "rgb(243, 244, 246)";

/**
 * A user-defined calendar that deviates from the type default and applies to an
 * explicitly chosen set of resource instances (e.g. `Worker_1`, `Worker_3`).
 * Resources not covered by any group fall back to their type calendar.
 */
export type CalendarOverrideGroup = {
  id: string;
  resourceIds: string[];
  calendar: CalendarProbability;
};

type Props = {
  resourcePool: Record<string, number>;
  typeCalendars: Record<string, CalendarProbability>;
  /** Discovered probability calendars per type (heatmap background / reset target). */
  discoveredTypeCalendars?: Record<string, CalendarProbability>;
  /** User-defined per-resource-set calendar overrides. */
  overrides: CalendarOverrideGroup[];
  onTypeCalendarUpdate: (resourceType: string, weekday: string, hours: number[]) => void;
  setOverrides: React.Dispatch<React.SetStateAction<CalendarOverrideGroup[]>>;
};

/** Build a 24-element array with 1.0 in [start, end) and 0 elsewhere. */
function rangeToHours(start: number, end: number): number[] {
  return Array.from({ length: 24 }, (_, h) => (h >= start && h < end ? 1 : 0));
}

/** Plain Mon–Fri 08:00–17:00 default calendar (weekend off). */
function makeDefaultCalendar(): CalendarProbability {
  const weekday = rangeToHours(8, 17);
  const cal: CalendarProbability = {};
  for (const d of WEEKDAYS) cal[d] = d === "Saturday" || d === "Sunday" ? Array(24).fill(0) : [...weekday];
  return cal;
}

function cloneCalendar(src: CalendarProbability): CalendarProbability {
  const out: CalendarProbability = {};
  for (const d of WEEKDAYS) out[d] = [...(src[d] || Array(24).fill(0))];
  return out;
}

/** Contiguous [start, end) segments of "on" (value > 0) hours. */
function hoursToSegments(hours: number[]): [number, number][] {
  const segments: [number, number][] = [];
  let start = -1;
  for (let h = 0; h < 24; h++) {
    if (hours[h] > 0) {
      if (start === -1) start = h;
    } else if (start !== -1) {
      segments.push([start, h]);
      start = -1;
    }
  }
  if (start !== -1) segments.push([start, 24]);
  return segments;
}

function formatSegments(hours: number[]): string {
  return hoursToSegments(hours)
    .map(([s, e]) => `${s}–${e}`)
    .join(", ");
}

function countHours(hours: number[]): number {
  return hours.reduce((acc, v) => acc + (v > 0 ? 1 : 0), 0);
}

function arraysEqual(a?: number[], b?: number[]): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Mean of `probs` over the hours flagged "on" in `mask`; null if none. */
function meanOverMask(probs: number[] | undefined, mask: (h: number) => boolean): number | null {
  if (!probs) return null;
  let sum = 0;
  let n = 0;
  for (let h = 0; h < 24; h++) {
    if (mask(h)) {
      sum += probs[h] || 0;
      n++;
    }
  }
  return n === 0 ? null : sum / n;
}

export const ResourceCalendarEditor: React.FC<Props> = ({
  resourcePool,
  typeCalendars,
  discoveredTypeCalendars,
  overrides,
  onTypeCalendarUpdate,
  setOverrides,
}) => {
  const resourceTypes = Object.keys(resourcePool).filter((k) => resourcePool[k] > 0);
  const [selectedType, setSelectedType] = useState<string>(resourceTypes[0] || "");

  if (resourceTypes.length === 0) return null;

  const currentCalendar = selectedType ? typeCalendars[selectedType] : null;
  const discoveredCalendar = selectedType ? discoveredTypeCalendars?.[selectedType] : undefined;
  const hasDiscovered = !!discoveredCalendar && hasNonTrivialData(discoveredCalendar);

  // All resource instances of the pool, grouped by type (e.g. Worker_1 … Worker_N).
  const instancesByType = resourceTypes.map((t) => ({
    type: t,
    ids: Array.from({ length: resourcePool[t] }, (_, i) => `${t}_${i + 1}`),
  }));

  const addOverride = () => {
    const seed = currentCalendar ? cloneCalendar(currentCalendar) : makeDefaultCalendar();
    setOverrides((prev) => [
      ...prev,
      { id: `grp_${Date.now()}_${prev.length}`, resourceIds: [], calendar: seed },
    ]);
  };

  const removeOverride = (id: string) =>
    setOverrides((prev) => prev.filter((g) => g.id !== id));

  const toggleResource = (id: string, rid: string) =>
    setOverrides((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const has = g.resourceIds.includes(rid);
        return {
          ...g,
          resourceIds: has ? g.resourceIds.filter((r) => r !== rid) : [...g.resourceIds, rid],
        };
      }),
    );

  const updateOverrideDay = (id: string, weekday: string, hours: number[]) =>
    setOverrides((prev) =>
      prev.map((g) => (g.id === id ? { ...g, calendar: { ...g.calendar, [weekday]: hours } } : g)),
    );

  return (
    <Card>
      <CardHeader><CardTitle>Resource Calendar</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          By default every resource of a type follows its <strong>type calendar</strong>. The colored
          background shows the <strong>discovered per-hour availability</strong> from the event log — an
          untouched calendar keeps these probabilities and the simulation uses them directly. Click or
          drag across the hours to pin fixed working times (always available); reset (↺) restores the
          discovered probabilities. To give specific resources a different schedule, add a custom
          calendar below.
        </p>

        {/* Resource Type selector */}
        <div>
          <p className="text-xs text-muted-foreground mb-1">Resource Type:</p>
          <div className="flex flex-wrap gap-1">
            {resourceTypes.map((rt) => (
              <Badge
                key={rt}
                variant={selectedType === rt ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setSelectedType(rt)}
              >
                {rt} ({resourcePool[rt]})
              </Badge>
            ))}
          </div>
        </div>

        {/* Type-level weekly schedule (the default for every resource of the type) */}
        {selectedType && currentCalendar && (
          <div className="space-y-3">
            <p className="text-xs font-medium">
              Working hours for <strong>{selectedType}</strong>:
            </p>
            {!hasDiscovered && (
              <p className="text-xs text-yellow-600 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
                No calendar data discovered from event log — using default (Mon–Fri 08:00–17:00).
              </p>
            )}
            <WeeklySchedule
              calendar={currentCalendar}
              discovered={discoveredCalendar}
              onChange={(weekday, hours) => onTypeCalendarUpdate(selectedType, weekday, hours)}
            />
          </div>
        )}

        {/* Custom calendars for specific resources */}
        <div className="pt-3 border-t space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Custom calendars for specific resources</p>
              <p className="text-[10px] text-muted-foreground">
                Pick a set of resources and give them a schedule that deviates from their type calendar.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={addOverride}>
              + Add custom calendar
            </Button>
          </div>

          {overrides.map((group) => {
            // Resources already claimed by *other* groups cannot be picked here —
            // each resource belongs to at most one override.
            const claimedElsewhere = new Set<string>();
            overrides.forEach((g) => {
              if (g.id !== group.id) g.resourceIds.forEach((r) => claimedElsewhere.add(r));
            });
            const available = instancesByType
              .map(({ type, ids }) => ({ type, ids: ids.filter((r) => !claimedElsewhere.has(r)) }))
              .filter((x) => x.ids.length > 0);

            return (
              <div
                key={group.id}
                className="rounded border p-3 space-y-3"
                style={{ borderColor: `color-mix(in srgb, ${CHART_BLUE} 30%, transparent)` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <ResourceMultiSelect
                    instancesByType={available}
                    selected={group.resourceIds}
                    onToggle={(rid) => toggleResource(group.id, rid)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => removeOverride(group.id)}
                  >
                    Remove
                  </Button>
                </div>

                {group.resourceIds.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {group.resourceIds.map((rid) => (
                      <Badge key={rid} variant="secondary" className="text-[10px] gap-1">
                        {rid}
                        <button
                          className="hover:text-foreground"
                          onClick={() => toggleResource(group.id, rid)}
                          title="Remove from set"
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                {group.resourceIds.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">
                    Select at least one resource for this calendar to take effect.
                  </p>
                ) : (
                  <WeeklySchedule
                    calendar={group.calendar}
                    onChange={(weekday, hours) => updateOverrideDay(group.id, weekday, hours)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

/** Multi-select over the pool's resource instances, grouped by type, in a popover. */
const ResourceMultiSelect: React.FC<{
  instancesByType: { type: string; ids: string[] }[];
  selected: string[];
  onToggle: (rid: string) => void;
}> = ({ instancesByType, selected, onToggle }) => {
  const [open, setOpen] = useState(false);
  const label =
    selected.length === 0
      ? "Select resources…"
      : `${selected.length} resource${selected.length === 1 ? "" : "s"} selected`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="min-w-[14rem] justify-between">
          <span className="truncate">{label}</span>
          <span className="ml-2 text-xs opacity-60">▾</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search resources…" />
          <CommandList>
            <CommandEmpty>No resources available.</CommandEmpty>
            {instancesByType.map(({ type, ids }) => (
              <CommandGroup key={type} heading={type}>
                {ids.map((rid) => {
                  const isSel = selected.includes(rid);
                  return (
                    <CommandItem key={rid} value={rid} onSelect={() => onToggle(rid)}>
                      <span
                        className={`mr-2 inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[9px] ${
                          isSel
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-muted-foreground/40"
                        }`}
                      >
                        {isSel ? "✓" : ""}
                      </span>
                      {rid}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/** Check if calendar has any non-zero probabilities. */
function hasNonTrivialData(cal: CalendarProbability): boolean {
  for (const day of WEEKDAYS) {
    const hours = cal[day];
    if (hours && hours.some((v) => v > 0)) return true;
  }
  return false;
}

/**
 * Weekly schedule: one row per weekday. Each row shows a heatmap of the discovered
 * per-hour availability; clicking/dragging across the hours paints fixed working
 * times (binary), which allows arbitrary patterns including split shifts.
 */
const WeeklySchedule: React.FC<{
  calendar: CalendarProbability;
  discovered?: CalendarProbability;
  onChange: (weekday: string, hours: number[]) => void;
}> = ({ calendar, discovered, onChange }) => (
  <div className="space-y-1.5">
    {WEEKDAYS.map((day) => (
      <DayScheduleRow
        key={day}
        day={day}
        current={calendar[day] || Array(24).fill(0)}
        discovered={discovered?.[day]}
        onChange={(hours) => onChange(day, hours)}
      />
    ))}
    {/* Hour axis */}
    <div className="flex items-center gap-2 pt-0.5">
      <span className="w-8" />
      <div className="flex-1 flex">
        {HOURS.map((h) => (
          <div key={h} className="flex-1 text-center text-[8px] text-muted-foreground">
            {h % 6 === 0 ? h : ""}
          </div>
        ))}
      </div>
      <span className="w-[5.5rem]" />
      <span className="w-4" />
    </div>
  </div>
);

const DayScheduleRow: React.FC<{
  day: string;
  current: number[];
  discovered?: number[];
  onChange: (hours: number[]) => void;
}> = ({ day, current, discovered, onChange }) => {
  const hasDiscovered = !!discovered && discovered.some((v) => v > 0);
  // A day is "manual" (fixed binary hours) once it diverges from the discovered
  // probabilities, or whenever there is no discovered reference to fall back to.
  const isManual = !hasDiscovered || !arraysEqual(current, discovered);

  // Active drag state: the value being painted (1 = on, 0 = off) and the working
  // array. Editing an untouched (auto) day starts from an empty schedule.
  const paint = useRef<{ value: number; arr: number[] } | null>(null);

  useEffect(() => {
    const stop = () => {
      paint.current = null;
    };
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  const beginPaint = (h: number) => {
    const arr = isManual ? [...current] : Array(24).fill(0);
    const value = isManual && current[h] > 0 ? 0 : 1;
    arr[h] = value;
    paint.current = { value, arr };
    onChange([...arr]);
  };

  const extendPaint = (h: number) => {
    const p = paint.current;
    if (!p || p.arr[h] === p.value) return;
    p.arr[h] = p.value;
    onChange([...p.arr]);
  };

  const selected = (h: number) => isManual && current[h] > 0;
  const mean = meanOverMask(
    hasDiscovered ? discovered : undefined,
    isManual ? (h) => current[h] > 0 : (h) => (discovered?.[h] || 0) > 0
  );
  const meanLabel = mean === null ? "" : `${Math.round(mean * 100)}%`;

  const totalHours = countHours(current);
  const rightLabel = !isManual
    ? "probabilistic"
    : totalHours === 0
      ? "off"
      : formatSegments(current);

  return (
    <div className="flex items-center gap-2">
      <button
        className={`w-8 text-xs text-left font-medium transition-colors ${
          isManual && totalHours === 0 ? "text-muted-foreground line-through" : ""
        }`}
        onClick={() => onChange(isManual && totalHours > 0 ? Array(24).fill(0) : rangeToHours(8, 17))}
        title={isManual && totalHours > 0 ? "Set day off" : "Enable (08:00–17:00)"}
      >
        {day.slice(0, 3)}
      </button>

      {/* Paintable hour cells over the discovered-availability heatmap */}
      <div className="flex-1 h-6 flex gap-px rounded-sm overflow-hidden select-none touch-none">
        {HOURS.map((h) => {
          const val = discovered?.[h] || 0;
          const isSel = selected(h);
          const bg = isSel
            ? `color-mix(in srgb, ${CHART_BLUE} 80%, transparent)`
            : isManual
              ? val > 0
                ? `color-mix(in srgb, ${CHART_BLUE} ${Math.round(Math.max(6, val * 35))}%, transparent)`
                : EMPTY_CELL
              : val > 0
                ? `color-mix(in srgb, ${CHART_BLUE} ${Math.round(Math.max(12, val * 100))}%, transparent)`
                : EMPTY_CELL;
          return (
            <div
              key={h}
              className="flex-1 h-full cursor-pointer"
              style={{ backgroundColor: bg }}
              title={
                hasDiscovered
                  ? `${day} ${h}:00 – ${(val * 100).toFixed(0)}% available${isSel ? " · working" : ""}`
                  : `${day} ${h}:00${isSel ? " · working" : ""}`
              }
              onPointerDown={(e) => {
                e.preventDefault();
                beginPaint(h);
              }}
              onPointerEnter={(e) => {
                if (e.buttons & 1) extendPaint(h);
              }}
            />
          );
        })}
      </div>

      <span className="w-[5.5rem] text-[10px] text-right text-muted-foreground tabular-nums truncate" title={rightLabel}>
        {rightLabel}
      </span>
      <span className="w-4 flex items-center justify-center">
        {isManual && hasDiscovered ? (
          <button
            className="text-[11px] text-muted-foreground hover:text-foreground leading-none"
            onClick={() => onChange([...(discovered as number[])])}
            title="Reset to discovered probabilities"
          >
            ↺
          </button>
        ) : meanLabel ? (
          <span className="text-[9px] text-muted-foreground tabular-nums" title="Avg. discovered availability">
            {meanLabel}
          </span>
        ) : null}
      </span>
    </div>
  );
};

export default ResourceCalendarEditor;
