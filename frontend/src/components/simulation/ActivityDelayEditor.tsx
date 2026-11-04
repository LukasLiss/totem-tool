import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ActivityDelayDistribution } from "@/api/simulationApi";
import { SampleRangeSelector, formatDuration } from "@/components/simulation/SampleRangeSelector";

type Props = {
  delays: ActivityDelayDistribution;
  onUpdate: (activity: string, selectMin: number, selectMax: number) => void;
};

export const ActivityDelayEditor: React.FC<Props> = ({ delays, onUpdate }) => {
  const activities = Object.keys(delays).sort();

  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground mb-4">
          Empirical distribution of the time between an event becoming possible
          (all its direct predecessors have occurred) and its occurrence. The
          simulation draws each delay directly from these observed values. Drag
          the handles (or use the presets) to restrict the range the simulation
          draws from; values outside it are excluded. Activities that only start
          an execution have no delay and are not listed.
        </p>
        <div className="space-y-4">
          {activities.map((act) => {
            const stats = delays[act];
            const edges = stats.bin_edges ?? [];
            const counts = stats.bin_counts ?? [];
            const domainLo = edges[0] ?? 0;
            const domainHi = edges[edges.length - 1] ?? 0;
            return (
              <div key={act} className="border rounded p-3 space-y-1.5">
                <p className="text-sm font-medium">{act}</p>
                {domainHi <= domainLo ? (
                  <p className="text-[10px] text-muted-foreground">
                    Constant delay: {formatDuration(domainLo)}
                  </p>
                ) : (
                  <SampleRangeSelector
                    edges={edges}
                    counts={counts}
                    minS={stats.min_duration_s}
                    maxS={stats.max_duration_s}
                    selMin={stats.select_min_s ?? domainLo}
                    selMax={stats.select_max_s ?? domainHi}
                    onChange={(a, b) => onUpdate(act, a, b)}
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

export default ActivityDelayEditor;
