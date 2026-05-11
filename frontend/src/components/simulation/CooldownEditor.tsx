import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CooldownDistribution } from "@/api/simulationApi";

type Props = {
  cooldowns: CooldownDistribution;
  onUpdate: (activity: string, resourceType: string, meanDuration: number, stdDuration: number) => void;
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** Choose a uniform step size based on the scale of the max value. */
function uniformStep(maxVal: number): number {
  if (maxVal <= 120) return 1;          // up to 2min: 1s steps
  if (maxVal <= 600) return 5;          // up to 10min: 5s steps
  if (maxVal <= 3600) return 30;        // up to 1h: 30s steps
  if (maxVal <= 36000) return 300;      // up to 10h: 5min steps
  return 1800;                          // above: 30min steps
}

/** Format step unit for display. */
function stepLabel(step: number): string {
  if (step < 60) return `${step}s steps`;
  return `${step / 60}min steps`;
}

/** Get the display unit label and conversion factor for input fields based on step size. */
function inputUnit(step: number): { label: string; toDisplay: (s: number) => number; toSeconds: (v: number) => number; displayStep: number } {
  if (step <= 5) return { label: "s", toDisplay: (s) => Math.round(s), toSeconds: (v) => v, displayStep: step };
  if (step <= 300) return { label: "min", toDisplay: (s) => Math.round((s / 60) * 10) / 10, toSeconds: (v) => v * 60, displayStep: Math.round((step / 60) * 10) / 10 };
  return { label: "h", toDisplay: (s) => Math.round((s / 3600) * 100) / 100, toSeconds: (v) => v * 3600, displayStep: Math.round((step / 3600) * 100) / 100 };
}

export const CooldownEditor: React.FC<Props> = ({ cooldowns, onUpdate }) => {
  const [textMode, setTextMode] = useState(false);
  const activities = Object.keys(cooldowns).sort();

  // Compute stable slider max values from discovered data (not from current edited values)
  const sliderMaxes = useMemo(() => {
    const maxes: Record<string, Record<string, number>> = {};
    for (const act of Object.keys(cooldowns)) {
      maxes[act] = {};
      for (const [resType, stats] of Object.entries(cooldowns[act])) {
        const discoveredHigh = stats.mean_duration_s + 2 * stats.std_duration_s;
        maxes[act][resType] = Math.max(
          discoveredHigh * 3,
          stats.max_duration_s * 2,
          60
        );
      }
    }
    return maxes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(cooldowns).join(",")]);

  if (activities.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Resource Cooldowns</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No cooldown data discovered.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Resource Cooldowns</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="cooldown-text-mode" className="text-xs text-muted-foreground">Text input</Label>
            <Switch id="cooldown-text-mode" checked={textMode} onCheckedChange={setTextMode} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-4">
          Duration range a resource is blocked after performing an activity.
          The simulation samples from N(mean, std).
        </p>
        <div className="space-y-4">
          {activities.map((act) => {
            const resTypes = Object.entries(cooldowns[act]).sort(([a], [b]) => a.localeCompare(b));
            return (
              <div key={act} className="border rounded p-3">
                <p className="text-sm font-medium mb-3">{act}</p>
                <div className="space-y-3">
                  {resTypes.map(([resType, stats]) => {
                    const low = Math.max(0, stats.mean_duration_s - 2 * stats.std_duration_s);
                    const high = stats.mean_duration_s + 2 * stats.std_duration_s;
                    const sliderMax = sliderMaxes[act]?.[resType] ?? 60;
                    const step = uniformStep(sliderMax);

                    const unit = inputUnit(step);

                    const applyRange = (newLow: number, newHigh: number) => {
                      const cLow = Math.max(0, Math.min(newLow, newHigh));
                      const cHigh = Math.max(cLow, newHigh);
                      const mean = (cLow + cHigh) / 2;
                      const std = Math.max(0, (cHigh - cLow) / 4);
                      onUpdate(act, resType, mean, std);
                    };

                    return (
                      <div key={resType} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{resType}</span>
                          <span className="text-xs text-muted-foreground">
                            {stats.sample_count} samples
                            {" · "}discovered: {formatDuration(stats.min_duration_s)} – {formatDuration(stats.max_duration_s)}
                          </span>
                        </div>

                        {textMode ? (
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground w-10">Mean:</span>
                              <Input
                                type="number"
                                min={0}
                                step={1}
                                value={Math.round(stats.mean_duration_s)}
                                onChange={(e) => onUpdate(act, resType, parseFloat(e.target.value) || 0, stats.std_duration_s)}
                                className="h-6 w-24 text-xs"
                              />
                              <span className="text-[10px] text-muted-foreground">s</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground w-10">Std:</span>
                              <Input
                                type="number"
                                min={0}
                                step={1}
                                value={Math.round(stats.std_duration_s)}
                                onChange={(e) => onUpdate(act, resType, stats.mean_duration_s, parseFloat(e.target.value) || 0)}
                                className="h-6 w-24 text-xs"
                              />
                              <span className="text-[10px] text-muted-foreground">s</span>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-0.5">
                                <Input
                                  type="number"
                                  min={0}
                                  step={unit.displayStep}
                                  value={unit.toDisplay(low)}
                                  onChange={(e) => applyRange(unit.toSeconds(parseFloat(e.target.value) || 0), high)}
                                  className="h-6 w-20 text-xs font-mono"
                                  title={`Lower bound (${unit.label})`}
                                />
                                <span className="text-[10px] text-muted-foreground w-6">{unit.label}</span>
                              </div>
                              <Slider
                                value={[low, high]}
                                onValueChange={([newLow, newHigh]) => applyRange(newLow, newHigh)}
                                min={0}
                                max={sliderMax}
                                step={step}
                                className="flex-1"
                              />
                              <div className="flex items-center gap-0.5">
                                <Input
                                  type="number"
                                  min={0}
                                  step={unit.displayStep}
                                  value={unit.toDisplay(high)}
                                  onChange={(e) => applyRange(low, unit.toSeconds(parseFloat(e.target.value) || 0))}
                                  className="h-6 w-20 text-xs font-mono"
                                  title={`Upper bound (${unit.label})`}
                                />
                                <span className="text-[10px] text-muted-foreground w-6">{unit.label}</span>
                              </div>
                            </div>
                            <div className="flex justify-center">
                              <span className="text-[10px] text-muted-foreground">
                                {formatDuration(low)} – {formatDuration(high)}
                                {" · "}mean: {formatDuration(stats.mean_duration_s)} · std: {formatDuration(stats.std_duration_s)}
                                {" · "}{stepLabel(step)}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default CooldownEditor;
