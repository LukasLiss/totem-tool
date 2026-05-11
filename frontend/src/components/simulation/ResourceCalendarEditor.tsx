import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { CalendarProbability } from "@/api/simulationApi";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const CHART_BLUE = "var(--chart-2, #2d62ef)";

type Props = {
  resourcePool: Record<string, number>;
  typeCalendars: Record<string, CalendarProbability>;
  resourceCalendars: Record<string, CalendarProbability>;
  onTypeCalendarUpdate: (resourceType: string, weekday: string, hours: number[]) => void;
  onResourceCalendarUpdate: (resourceId: string, weekday: string, hours: number[]) => void;
};

/** Extract contiguous working-hours range from a 24-element array. */
function getWorkingRange(hours: number[]): [number, number] {
  let start = -1;
  let end = -1;
  for (let h = 0; h < 24; h++) {
    if (hours[h] > 0) {
      if (start === -1) start = h;
      end = h + 1;
    }
  }
  return start === -1 ? [0, 0] : [start, end];
}

/** Build a 24-element array with 1.0 in [start, end) and 0 elsewhere. */
function rangeToHours(start: number, end: number): number[] {
  return Array.from({ length: 24 }, (_, h) => (h >= start && h < end ? 1 : 0));
}

function formatHour(h: number): string {
  return `${h.toString().padStart(2, "0")}:00`;
}

export const ResourceCalendarEditor: React.FC<Props> = ({
  resourcePool,
  typeCalendars,
  resourceCalendars,
  onTypeCalendarUpdate,
  onResourceCalendarUpdate,
}) => {
  const resourceTypes = Object.keys(resourcePool).filter((k) => resourcePool[k] > 0);
  const [selectedType, setSelectedType] = useState<string>(resourceTypes[0] || "");
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string>("");

  if (resourceTypes.length === 0) return null;

  const currentCalendar = selectedType ? typeCalendars[selectedType] : null;
  const resourceCount = selectedType ? (resourcePool[selectedType] || 0) : 0;
  const individualResourceIds = Array.from({ length: resourceCount }, (_, i) => `${selectedType}_${i + 1}`);

  const currentResourceCalendar = selectedResourceId ? resourceCalendars[selectedResourceId] : null;

  return (
    <Card>
      <CardHeader><CardTitle>Resource Calendar</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Set working hours for each resource type. Individual resources inherit the type schedule unless overridden.
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
            <WeeklySchedule
              calendar={currentCalendar}
              onChange={(weekday, hours) => onTypeCalendarUpdate(selectedType, weekday, hours)}
            />

            {/* Heatmap summary */}
            <CalendarHeatmap calendar={currentCalendar} />
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
                      onChange={(weekday, hours) => onResourceCalendarUpdate(selectedResourceId, weekday, hours)}
                    />
                    <CalendarHeatmap calendar={currentResourceCalendar} />
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
                        // Initialize individual calendar from type calendar
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

/** Weekly schedule editor: one row per weekday with a time-range slider. */
const WeeklySchedule: React.FC<{
  calendar: CalendarProbability;
  onChange: (weekday: string, hours: number[]) => void;
}> = ({ calendar, onChange }) => (
  <div className="space-y-2">
    {WEEKDAYS.map((day) => {
      const hours = calendar[day] || Array(24).fill(0);
      const [start, end] = getWorkingRange(hours);
      const isActive = start !== end;

      return (
        <div key={day} className="flex items-center gap-2">
          {/* Day label + toggle */}
          <button
            className={`w-10 text-xs text-left font-medium transition-colors ${
              isActive ? "" : "text-muted-foreground line-through"
            }`}
            onClick={() => {
              if (isActive) {
                onChange(day, Array(24).fill(0));
              } else {
                onChange(day, rangeToHours(8, 17));
              }
            }}
            title={isActive ? "Click to set day off" : "Click to enable (8:00-17:00)"}
          >
            {day.slice(0, 3)}
          </button>

          <span className="text-[10px] text-muted-foreground w-10 text-right">
            {isActive ? formatHour(start) : ""}
          </span>
          <Slider
            value={isActive ? [start, end] : [0, 0]}
            onValueChange={([newStart, newEnd]) => {
              if (newStart === newEnd) {
                onChange(day, Array(24).fill(0));
              } else {
                onChange(day, rangeToHours(newStart, newEnd));
              }
            }}
            min={0}
            max={24}
            step={1}
            className="flex-1"
          />
          <span className="text-[10px] text-muted-foreground w-10">
            {isActive ? formatHour(end) : ""}
          </span>
          <span className="text-[10px] text-muted-foreground w-8 text-right">
            {isActive ? `${end - start}h` : "off"}
          </span>
        </div>
      );
    })}
  </div>
);

/** Compact heatmap: 7 days x 24 hours grid. */
const CalendarHeatmap: React.FC<{
  calendar: CalendarProbability;
}> = ({ calendar }) => (
  <div className="space-y-0.5">
    {WEEKDAYS.map((day) => (
      <div key={day} className="flex items-center gap-1">
        <span className="text-[9px] w-5 text-muted-foreground">{day.slice(0, 2)}</span>
        <div className="flex-1 flex gap-px">
          {(calendar[day] || HOURS.map(() => 0)).map((val, h) => (
            <div
              key={h}
              className="flex-1 h-3 rounded-sm"
              style={{
                backgroundColor: val > 0
                  ? `color-mix(in srgb, ${CHART_BLUE} ${Math.round(Math.max(20, val * 100))}%, transparent)`
                  : "rgb(240, 240, 240)",
              }}
              title={`${day} ${h}:00 – ${val > 0 ? "working" : "off"}`}
            />
          ))}
        </div>
      </div>
    ))}
    {/* Hour labels */}
    <div className="flex items-center gap-1">
      <span className="w-5" />
      <div className="flex-1 flex">
        {HOURS.map((h) => (
          <div key={h} className="flex-1 text-center text-[8px] text-muted-foreground">
            {h % 6 === 0 ? h : ""}
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default ResourceCalendarEditor;
