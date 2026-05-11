import React, { useState, useRef, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { VariantDetail } from "@/api/simulationApi";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const CHART_BLUE = "var(--chart-2, #2d62ef)";

type Props = {
  variants: VariantDetail[];
  onArrivalUpdate?: (variantId: number, weekday: string, hour: number, value: number) => void;
};

export const ArrivalDistributionEditor: React.FC<Props> = ({ variants, onArrivalUpdate }) => {
  const [selectedVariant, setSelectedVariant] = useState(0);
  const [selectedWeekday, setSelectedWeekday] = useState("Monday");
  const [textMode, setTextMode] = useState(false);

  const variant = variants[selectedVariant];
  if (!variant) return null;

  const arrival = variant.arrival_distribution;
  const hourlyData = arrival.avg_arrivals_per_hour?.[selectedWeekday] || {};
  const hourlyValues = HOURS.map((h) => hourlyData[h.toString()] || hourlyData[h] || 0);
  const maxVal = Math.max(...hourlyValues, 0.1);

  // Compute daily totals from hourly data (more meaningful than probabilities)
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Arrival Distribution</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="text-mode" className="text-xs text-muted-foreground">Text input</Label>
            <Switch id="text-mode" checked={textMode} onCheckedChange={setTextMode} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
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
                selectedWeekday === day
                  ? "text-white"
                  : "hover:bg-accent border-muted"
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

        {/* Weekday overview - daily totals (frequencies, not probabilities) */}
        <div className="mt-4">
          <p className="text-xs text-muted-foreground mb-1">
            Daily arrival totals (sum of hourly avg){weeklyTotal > 0 && <span className="ml-1">— weekly total: {weeklyTotal.toFixed(1)}</span>}:
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
      </CardContent>
    </Card>
  );
};

// Interactive bar chart with drag
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
      {/* Y-axis labels */}
      <div className="absolute left-0 top-0 bottom-3 w-8 flex flex-col justify-between text-[9px] text-muted-foreground pointer-events-none pr-1 text-right">
        <span>{displayMax.toFixed(1)}</span>
        <span>{(displayMax / 2).toFixed(1)}</span>
        <span>0</span>
      </div>

      {/* Bars */}
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

      {/* X-axis labels */}
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
