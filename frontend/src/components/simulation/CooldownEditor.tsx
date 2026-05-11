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
                    const step = Math.max(1, Math.round(sliderMax / 200));

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
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-mono w-14 text-right">{formatDuration(low)}</span>
                              <Slider
                                value={[low, high]}
                                onValueChange={([newLow, newHigh]) => {
                                  const mean = (newLow + newHigh) / 2;
                                  const std = Math.max(0, (newHigh - newLow) / 4);
                                  onUpdate(act, resType, mean, std);
                                }}
                                min={0}
                                max={sliderMax}
                                step={step}
                                className="flex-1"
                              />
                              <span className="text-xs font-mono w-14">{formatDuration(high)}</span>
                            </div>
                            <div className="flex justify-center">
                              <span className="text-[10px] text-muted-foreground">
                                mean: {formatDuration(stats.mean_duration_s)} · std: {formatDuration(stats.std_duration_s)}
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
