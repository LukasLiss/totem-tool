import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { VariantDetail } from "@/api/simulationApi";

/** Input that keeps local state while typing and only applies on blur / Enter. */
const DeferredInput: React.FC<{
  value: number;
  onApply: (val: number) => void;
  min?: number;
  step?: number;
  className?: string;
}> = ({ value, onApply, min = 0, step = 1, className }) => {
  const [local, setLocal] = useState(String(value));
  const [focused, setFocused] = useState(false);

  // Sync from parent when not focused
  useEffect(() => {
    if (!focused) setLocal(String(Math.round(value * 10) / 10));
  }, [value, focused]);

  const apply = () => {
    const parsed = parseFloat(local);
    if (!isNaN(parsed) && parsed >= min) onApply(parsed);
    else setLocal(String(Math.round(value * 10) / 10));
  };

  return (
    <Input
      type="number"
      min={min}
      step={step}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); apply(); }}
      onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } }}
      className={className}
    />
  );
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const CHART_BLUE = "var(--chart-2, #2d62ef)";

type GranularityLevel = "weekly" | "per-variant" | "per-day" | "per-hour";
const LEVELS: { key: GranularityLevel; label: string }[] = [
  { key: "weekly", label: "Weekly Total" },
  { key: "per-variant", label: "Per Variant / Week" },
  { key: "per-day", label: "Per Variant / Day" },
  { key: "per-hour", label: "Per Variant / Hour" },
];

type Props = {
  variants: VariantDetail[];
  onArrivalUpdate?: (variantId: number, weekday: string, hour: number, value: number) => void;
};

/** Compute the total weekly arrivals for a single variant from its hourly data. */
function variantWeeklyTotal(variant: VariantDetail): number {
  let total = 0;
  const hourly = variant.arrival_distribution.avg_arrivals_per_hour || {};
  for (const day of WEEKDAYS) {
    const dayData = hourly[day] || {};
    for (const h of HOURS) {
      total += dayData[h.toString()] || dayData[h] || 0;
    }
  }
  return total;
}

/** Compute daily total for a variant on a specific weekday. */
function variantDayTotal(variant: VariantDetail, weekday: string): number {
  const dayData = variant.arrival_distribution.avg_arrivals_per_hour?.[weekday] || {};
  let total = 0;
  for (const h of HOURS) {
    total += dayData[h.toString()] || dayData[h] || 0;
  }
  return total;
}

export const ArrivalDistributionEditor: React.FC<Props> = ({ variants, onArrivalUpdate }) => {
  const [granularity, setGranularity] = useState<GranularityLevel>("per-day");
  const [selectedVariant, setSelectedVariant] = useState(0);
  const [selectedWeekday, setSelectedWeekday] = useState("Monday");
  const [textMode, setTextMode] = useState(false);

  const variant = variants[selectedVariant];

  // Compute totals
  const weeklyTotalAll = useMemo(
    () => variants.reduce((sum, v) => sum + variantWeeklyTotal(v), 0),
    [variants]
  );

  const variantWeeklyTotals = useMemo(
    () => variants.map((v) => variantWeeklyTotal(v)),
    [variants]
  );

  /** Scale ALL hourly values across ALL variants proportionally to match a new weekly total. */
  const setWeeklyTotal = (newTotal: number) => {
    if (!onArrivalUpdate || weeklyTotalAll === 0) return;
    const scale = newTotal / weeklyTotalAll;
    for (const v of variants) {
      const hourly = v.arrival_distribution.avg_arrivals_per_hour || {};
      for (const day of WEEKDAYS) {
        const dayData = hourly[day] || {};
        for (const h of HOURS) {
          const old = dayData[h.toString()] || dayData[h] || 0;
          if (old > 0) onArrivalUpdate(v.id, day, h, Math.round(old * scale * 100) / 100);
        }
      }
    }
  };

  /** Scale a single variant's hourly values to match a new weekly total for that variant. */
  const setVariantWeekly = (variantIdx: number, newTotal: number) => {
    if (!onArrivalUpdate) return;
    const v = variants[variantIdx];
    const currentTotal = variantWeeklyTotal(v);
    if (currentTotal === 0) {
      // Distribute evenly across weekday working hours (Mon-Fri 8-17)
      const hoursPerWeek = 5 * 9;
      const perHour = newTotal / hoursPerWeek;
      for (const day of WEEKDAYS.slice(0, 5)) {
        for (let h = 8; h < 17; h++) {
          onArrivalUpdate(v.id, day, h, Math.round(perHour * 100) / 100);
        }
      }
      return;
    }
    const scale = newTotal / currentTotal;
    const hourly = v.arrival_distribution.avg_arrivals_per_hour || {};
    for (const day of WEEKDAYS) {
      const dayData = hourly[day] || {};
      for (const h of HOURS) {
        const old = dayData[h.toString()] || dayData[h] || 0;
        if (old > 0) onArrivalUpdate(v.id, day, h, Math.round(old * scale * 100) / 100);
      }
    }
  };

  /** Scale a single variant's hourly values on a specific day to match a new daily total. */
  const setVariantDayTotal = (variantIdx: number, weekday: string, newTotal: number) => {
    if (!onArrivalUpdate) return;
    const v = variants[variantIdx];
    const currentDayTotal = variantDayTotal(v, weekday);
    const dayData = v.arrival_distribution.avg_arrivals_per_hour?.[weekday] || {};
    if (currentDayTotal === 0) {
      // Distribute evenly across working hours (8-17)
      const perHour = newTotal / 9;
      for (let h = 8; h < 17; h++) {
        onArrivalUpdate(v.id, weekday, h, Math.round(perHour * 100) / 100);
      }
      return;
    }
    const scale = newTotal / currentDayTotal;
    for (const h of HOURS) {
      const old = dayData[h.toString()] || dayData[h] || 0;
      if (old > 0) onArrivalUpdate(v.id, weekday, h, Math.round(old * scale * 100) / 100);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Arrival Distribution</CardTitle>
          {granularity === "per-hour" && (
            <div className="flex items-center gap-2">
              <Label htmlFor="text-mode" className="text-xs text-muted-foreground">Text input</Label>
              <Switch id="text-mode" checked={textMode} onCheckedChange={setTextMode} />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Granularity level selector */}
        <div className="flex gap-1">
          {LEVELS.map(({ key, label }) => (
            <button
              key={key}
              className={`flex-1 text-xs py-1.5 px-2 rounded border transition-colors ${
                granularity === key ? "text-white" : "hover:bg-accent border-muted"
              }`}
              style={granularity === key ? { backgroundColor: CHART_BLUE, borderColor: CHART_BLUE } : {}}
              onClick={() => setGranularity(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Level 1: Weekly Total */}
        {granularity === "weekly" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Set the total number of arrivals per week across all variants. The existing distribution is preserved proportionally.
            </p>
            <div className="flex items-center gap-3">
              <Label className="text-sm">Total arrivals / week:</Label>
              <DeferredInput
                value={weeklyTotalAll}
                onApply={setWeeklyTotal}
                className="w-32"
              />
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Breakdown by variant:</p>
              {variants.map((v, idx) => (
                <div key={v.id} className="flex items-center gap-2 ml-2">
                  <span>Variant {idx + 1}:</span>
                  <span className="font-medium">
                    {variantWeeklyTotals[idx].toFixed(1)} / week
                    {weeklyTotalAll > 0 && (
                      <span className="text-muted-foreground ml-1">
                        ({((variantWeeklyTotals[idx] / weeklyTotalAll) * 100).toFixed(0)}%)
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Level 2: Per Variant / Week */}
        {granularity === "per-variant" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Set how many arrivals per week for each variant. The day/hour distribution within each variant is preserved proportionally.
            </p>
            <div className="space-y-2">
              {variants.map((v, idx) => (
                <div key={v.id} className="flex items-center gap-3">
                  <Badge variant="outline" className="w-24 justify-center">
                    Variant {idx + 1}
                  </Badge>
                  <DeferredInput
                    value={variantWeeklyTotals[idx]}
                    onApply={(val) => setVariantWeekly(idx, val)}
                    className="w-28"
                  />
                  <span className="text-xs text-muted-foreground">/ week</span>
                  <span className="text-xs text-muted-foreground">(sup: {v.support})</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Total: {weeklyTotalAll.toFixed(1)} / week
            </p>
          </div>
        )}

        {/* Level 3: Per Variant / Day */}
        {granularity === "per-day" && (
          <PerDayEditor
            variants={variants}
            selectedVariant={selectedVariant}
            setSelectedVariant={setSelectedVariant}
            onSetDayTotal={setVariantDayTotal}
          />
        )}

        {/* Level 4: Per Variant / Hour (existing detailed view) */}
        {granularity === "per-hour" && variant && (
          <PerHourEditor
            variants={variants}
            variant={variant}
            selectedVariant={selectedVariant}
            setSelectedVariant={setSelectedVariant}
            selectedWeekday={selectedWeekday}
            setSelectedWeekday={setSelectedWeekday}
            textMode={textMode}
            onArrivalUpdate={onArrivalUpdate}
          />
        )}
      </CardContent>
    </Card>
  );
};

// --- Per-Day Editor ---

const PerDayEditor: React.FC<{
  variants: VariantDetail[];
  selectedVariant: number;
  setSelectedVariant: (idx: number) => void;
  onSetDayTotal: (variantIdx: number, weekday: string, newTotal: number) => void;
}> = ({ variants, selectedVariant, setSelectedVariant, onSetDayTotal }) => {
  const v = variants[selectedVariant];
  if (!v) return null;

  const dailyTotals = WEEKDAYS.map((day) => variantDayTotal(v, day));
  const weekTotal = dailyTotals.reduce((s, d) => s + d, 0);
  const maxDaily = Math.max(...dailyTotals, 0.1);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Set daily arrival totals for each variant. Hour distribution within each day is preserved proportionally.
      </p>

      {/* Variant selector */}
      <div className="flex flex-wrap gap-1">
        {variants.map((v, idx) => (
          <Badge
            key={v.id}
            variant={selectedVariant === idx ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setSelectedVariant(idx)}
          >
            Variant {idx + 1} (sup: {v.support})
          </Badge>
        ))}
      </div>

      {/* Daily totals with bar chart + inputs */}
      <div className="space-y-1.5">
        {WEEKDAYS.map((day, di) => {
          const total = dailyTotals[di];
          const barWidth = maxDaily > 0 ? (total / maxDaily) * 100 : 0;
          return (
            <div key={day} className="flex items-center gap-2">
              <span className="text-xs w-8">{day.slice(0, 3)}</span>
              <div className="flex-1 h-5 bg-muted/30 rounded relative">
                <div
                  className="h-full rounded transition-all"
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: `color-mix(in srgb, ${CHART_BLUE} 60%, transparent)`,
                  }}
                />
              </div>
              <DeferredInput
                value={total}
                onApply={(val) => onSetDayTotal(selectedVariant, day, val)}
                step={0.1}
                className="w-20 h-6 text-xs"
              />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Weekly total for Variant {selectedVariant + 1}: {weekTotal.toFixed(1)}
      </p>
    </div>
  );
};

// --- Per-Hour Editor (detailed, existing) ---

const PerHourEditor: React.FC<{
  variants: VariantDetail[];
  variant: VariantDetail;
  selectedVariant: number;
  setSelectedVariant: (idx: number) => void;
  selectedWeekday: string;
  setSelectedWeekday: (day: string) => void;
  textMode: boolean;
  onArrivalUpdate?: Props["onArrivalUpdate"];
}> = ({ variants, variant, selectedVariant, setSelectedVariant, selectedWeekday, setSelectedWeekday, textMode, onArrivalUpdate }) => {
  const arrival = variant.arrival_distribution;
  const hourlyData = arrival.avg_arrivals_per_hour?.[selectedWeekday] || {};
  const hourlyValues = HOURS.map((h) => hourlyData[h.toString()] || hourlyData[h] || 0);
  const maxVal = Math.max(...hourlyValues, 0.1);

  const dailyTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const day of WEEKDAYS) {
      const dayData = arrival.avg_arrivals_per_hour?.[day] || {};
      let sum = 0;
      for (const h of HOURS) {
        sum += dayData[h.toString()] || dayData[h] || 0;
      }
      totals[day] = sum;
    }
    return totals;
  }, [arrival]);

  const weeklyTotal = useMemo(
    () => Object.values(dailyTotals).reduce((s, v) => s + v, 0),
    [dailyTotals]
  );

  return (
    <div className="space-y-4">
      {/* Variant selector */}
      <div className="flex flex-wrap gap-1">
        {variants.map((v, idx) => (
          <Badge
            key={v.id}
            variant={selectedVariant === idx ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setSelectedVariant(idx)}
          >
            Variant {idx + 1} (sup: {v.support})
          </Badge>
        ))}
      </div>

      {/* Weekday selector */}
      <div className="flex gap-1">
        {WEEKDAYS.map((day) => (
          <button
            key={day}
            className={`flex-1 text-xs py-1.5 rounded border transition-colors ${
              selectedWeekday === day ? "text-white" : "hover:bg-accent border-muted"
            }`}
            style={selectedWeekday === day ? { backgroundColor: CHART_BLUE, borderColor: CHART_BLUE } : {}}
            onClick={() => setSelectedWeekday(day)}
          >
            {day.slice(0, 3)}
          </button>
        ))}
      </div>

      {/* Chart or text input mode */}
      {textMode ? (
        <div>
          <p className="text-xs text-muted-foreground mb-2">
            Avg arrivals per hour on <strong>{selectedWeekday}</strong>:
          </p>
          <div className="grid grid-cols-6 gap-1">
            {HOURS.map((h) => (
              <div key={h} className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground w-5 text-right">{h}h</span>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={hourlyValues[h]}
                  onChange={(e) =>
                    onArrivalUpdate?.(variant.id, selectedWeekday, h, parseFloat(e.target.value) || 0)
                  }
                  className="h-6 text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            Avg arrivals per hour on <strong>{selectedWeekday}</strong> (drag to adjust):
          </p>
          <HourlyBarChart
            values={hourlyValues}
            maxVal={maxVal}
            onChange={(hour, value) =>
              onArrivalUpdate?.(variant.id, selectedWeekday, hour, value)
            }
          />
        </div>
      )}

      {/* Weekday overview */}
      <div className="mt-4">
        <p className="text-xs text-muted-foreground mb-1">
          Daily totals{weeklyTotal > 0 && <span className="ml-1">— weekly: {weeklyTotal.toFixed(1)}</span>}:
        </p>
        <div className="flex items-end gap-1 h-20">
          {WEEKDAYS.map((day) => {
            const total = dailyTotals[day];
            const maxTotal = Math.max(...Object.values(dailyTotals), 0.01);
            const heightPercent = (total / maxTotal) * 100;
            return (
              <div key={day} className="flex-1 flex flex-col items-center">
                <span className="text-[9px] text-muted-foreground mb-0.5">
                  {total > 0 ? total.toFixed(1) : "0"}
                </span>
                <div
                  className="w-full rounded-t transition-all"
                  style={{
                    height: `${heightPercent}%`,
                    minHeight: total > 0 ? 2 : 0,
                    backgroundColor: selectedWeekday === day ? CHART_BLUE : `color-mix(in srgb, ${CHART_BLUE} 40%, transparent)`,
                  }}
                />
                <span className="text-[10px] text-muted-foreground mt-0.5">{day.slice(0, 2)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// --- Interactive bar chart with drag ---

const HourlyBarChart: React.FC<{
  values: number[];
  maxVal: number;
  onChange: (hour: number, value: number) => void;
}> = ({ values, maxVal, onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const chartHeight = 160;

  const getHourAndValue = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      if (!containerRef.current) return null;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const chartLeft = 32;
      const chartWidth = rect.width - chartLeft;
      const adjustedX = x - chartLeft;
      const hour = Math.floor((adjustedX / chartWidth) * 24);
      const clampedHour = Math.max(0, Math.min(23, hour));
      const chartInnerHeight = chartHeight - 12;
      const value = Math.max(0, (1 - y / chartInnerHeight) * maxVal * 1.2);
      return { hour: clampedHour, value: Math.round(value * 100) / 100 };
    },
    [maxVal, chartHeight]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    const result = getHourAndValue(e);
    if (result) onChange(result.hour, result.value);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const result = getHourAndValue(e);
    if (result) onChange(result.hour, result.value);
  };

  const handleMouseUp = () => setIsDragging(false);

  const displayMax = maxVal * 1.2;

  return (
    <div
      ref={containerRef}
      className="relative border rounded bg-muted/20 select-none cursor-crosshair"
      style={{ height: chartHeight }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="absolute left-0 top-0 bottom-3 w-8 flex flex-col justify-between text-[9px] text-muted-foreground pointer-events-none pr-1 text-right">
        <span>{displayMax.toFixed(1)}</span>
        <span>{(displayMax / 2).toFixed(1)}</span>
        <span>0</span>
      </div>

      <div className="absolute left-8 right-0 top-0 bottom-3 flex items-end">
        {values.map((val, hour) => {
          const heightPercent = (val / displayMax) * 100;
          return (
            <div key={hour} className="flex-1 flex flex-col items-center justify-end h-full px-px">
              <div
                className="w-full rounded-t transition-all duration-75"
                style={{
                  height: `${Math.max(heightPercent, 0)}%`,
                  minHeight: val > 0 ? 1 : 0,
                  backgroundColor: `color-mix(in srgb, ${CHART_BLUE} 75%, transparent)`,
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="absolute left-8 right-0 bottom-0 flex text-[9px] text-muted-foreground">
        {HOURS.map((h) => (
          <div key={h} className="flex-1 text-center">
            {h % 3 === 0 ? h : ""}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ArrivalDistributionEditor;
