import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CooldownDistribution } from "@/api/simulationApi";
import { SampleRangeSelector, formatDuration } from "@/components/simulation/SampleRangeSelector";

type Props = {
  cooldowns: CooldownDistribution;
  onUpdate: (activity: string, resourceType: string, selectMin: number, selectMax: number) => void;
};

export const CooldownEditor: React.FC<Props> = ({ cooldowns, onUpdate }) => {
  const activities = Object.keys(cooldowns).sort();

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
      <CardHeader><CardTitle>Resource Cooldowns</CardTitle></CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-4">
          Empirical distribution of how long a resource stays blocked after an
          activity. The simulation draws each cooldown directly from these
          observed values (no normal-distribution assumption). Drag the handles
          (or use the presets) to restrict the range the simulation draws from;
          values outside it are excluded.
        </p>
        <div className="space-y-4">
          {activities.map((act) => {
            const resTypes = Object.entries(cooldowns[act]).sort(([a], [b]) =>
              a.localeCompare(b),
            );
            return (
              <div key={act} className="border rounded p-3">
                <p className="text-sm font-medium mb-3">{act}</p>
                <div className="space-y-5">
                  {resTypes.map(([resType, stats]) => {
                    const edges = stats.bin_edges ?? [];
                    const counts = stats.bin_counts ?? [];
                    const domainLo = edges[0] ?? 0;
                    const domainHi = edges[edges.length - 1] ?? 0;
                    const selMin = stats.select_min_s ?? domainLo;
                    const selMax = stats.select_max_s ?? domainHi;

                    return (
                      <div key={resType} className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          {resType}
                        </span>
                        {counts.length === 0 ? (
                          <p className="text-[10px] text-muted-foreground">No samples.</p>
                        ) : domainHi <= domainLo ? (
                          <p className="text-[10px] text-muted-foreground">
                            Constant cooldown: {formatDuration(domainLo)}
                          </p>
                        ) : (
                          <SampleRangeSelector
                            edges={edges}
                            counts={counts}
                            minS={stats.min_duration_s}
                            maxS={stats.max_duration_s}
                            selMin={selMin}
                            selMax={selMax}
                            onChange={(a, b) => onUpdate(act, resType, a, b)}
                          />
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
