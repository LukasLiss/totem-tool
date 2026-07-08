import React, { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarProbability } from "@/api/simulationApi";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const CHART_BLUE = "var(--chart-2, #2d62ef)";
const EMPTY_CELL = "rgb(243, 244, 246)";

type Props = {
  resourcePool: Record<string, number>;
  typeCalendars: Record<string, CalendarProbability>;
  resourceCalendars: Record<string, CalendarProbability>;
  /** Discovered probability calendars per type (heatmap background / reset target). */
  discoveredTypeCalendars?: Record<string, CalendarProbability>;
  /** Discovered probability calendars per individual resource id. */
  discoveredResourceCalendars?: Record<string, CalendarProbability>;
  onTypeCalendarUpdate: (resourceType: string, weekday: string, hours: number[]) => void;
  onResourceCalendarUpdate: (resourceId: string, weekday: string, hours: number[]) => void;
};

/** Build a 24-element array with 1.0 in [start, end) and 0 elsewhere. */
function rangeToHours(start: number, end: number): number[] {
  return Array.from({ length: 24 }, (_, h) => (h >= start && h < end ? 1 : 0));
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
  resourceCalendars,
  discoveredTypeCalendars,
  discoveredResourceCalendars,
  onTypeCalendarUpdate,
  onResourceCalendarUpdate,
}) => {
  const resourceTypes = Object.keys(resourcePool).filter((k) => resourcePool[k] > 0);
  const [selectedType, setSelectedType] = useState<string>(resourceTypes[0] || "");
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string>("");

  if (resourceTypes.length === 0) return null;

  const currentCalendar = selectedType ? typeCalendars[selectedType] : null;
  const discoveredCalendar = selectedType ? discoveredTypeCalendars?.[selectedType] : undefined;
  const hasDiscovered = !!discoveredCalendar && hasNonTrivialData(discoveredCalendar);
  const resourceCount = selectedType ? (resourcePool[selectedType] || 0) : 0;
  const individualResourceIds = Array.from({ length: resourceCount }, (_, i) => `${selectedType}_${i + 1}`);

  const currentResourceCalendar = selectedResourceId ? resourceCalendars[selectedResourceId] : null;
  const discoveredResourceCalendar = selectedResourceId
    ? discoveredResourceCalendars?.[selectedResourceId]
    : undefined;

  return (
    <Card>
      <CardHeader><CardTitle>Resource Calendar</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          The colored background shows the <strong>discovered per-hour availability</strong> from the
          event log — an untouched calendar keeps these probabilities and the simulation uses them
          directly. Click or drag across the hours to pin fixed working times (always available). Reset (↺) restores the discovered probabilities.
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
                onClick={() => { setSelectedType(rt); setExpandedType(null); setSelectedResourceId(""); }}
              >
                {rt} ({resourcePool[rt]})
              </Badge>
            ))}
          </div>
        </div>

        {/* Type-level weekly schedule */}
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

        {/* Individual resources - collapsible */}
        {selectedType && resourceCount > 0 && (
          <div className="pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setExpandedType(expandedType === selectedType ? null : selectedType);
                setSelectedResourceId("");
              }}
            >
              {expandedType === selectedType ? "Hide Individual Resources" : `Individual Resources (${resourceCount})`}
            </Button>
          </div>
        )}

        {expandedType === selectedType && (
          <div className="space-y-3 pl-3 border-l-2" style={{ borderColor: `color-mix(in srgb, ${CHART_BLUE} 30%, transparent)` }}>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Select resource:</p>
              <div className="flex flex-wrap gap-1">
                {individualResourceIds.map((rid) => (
                  <Badge
                    key={rid}
                    variant={selectedResourceId === rid ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() => setSelectedResourceId(rid)}
                  >
                    {rid}
                  </Badge>
                ))}
              </div>
            </div>

            {selectedResourceId && (
              <div className="space-y-3">
                {currentResourceCalendar ? (
                  <>
                    <p className="text-xs font-medium">
                      Schedule for <strong>{selectedResourceId}</strong> (overrides type):
                    </p>
                    <WeeklySchedule
                      calendar={currentResourceCalendar}
                      discovered={discoveredResourceCalendar}
                      onChange={(weekday, hours) => onResourceCalendarUpdate(selectedResourceId, weekday, hours)}
                    />
                  </>
                ) : (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Inherits <strong>{selectedType}</strong> schedule. Click to create override:
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (currentCalendar) {
                          for (const day of WEEKDAYS) {
                            const hours = currentCalendar[day] || Array(24).fill(0);
                            onResourceCalendarUpdate(selectedResourceId, day, [...hours]);
                          }
                        }
                      }}
                    >
                      Create custom schedule
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
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
