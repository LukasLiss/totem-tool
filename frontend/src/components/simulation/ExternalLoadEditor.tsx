import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// One resource type's external-load setting: whether it is applied and the
// share of the type's capacity left for the process area.
export type ExternalLoadSetting = { enabled: boolean; share: number };

type Props = {
  resourcePool: Record<string, number>;
  discoveredShares: Record<string, number>;
  settings: Record<string, ExternalLoadSetting>;
  onChange: (resourceType: string, setting: ExternalLoadSetting) => void;
};

const clampShare = (v: number) => Math.min(1, Math.max(0, v));

const pct = (v: number) => `${(v * 100).toFixed(1)} %`;

export const ExternalLoadEditor: React.FC<Props> = ({
  resourcePool,
  discoveredShares,
  settings,
  onChange,
}) => {
  const resourceTypes = Object.keys(resourcePool)
    .filter((rt) => resourcePool[rt] > 0)
    .sort((a, b) => a.localeCompare(b));

  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground mb-4">
          Resources also work on activities outside this process area, which are
          not simulated. The share of a type's events that belong to the process
          area is taken as the share of its capacity available here (a heuristic
          based on event frequency, not a measured utilisation). In every hour a
          resource is reserved for external work with probability 1 − share: it
          cannot start process-area work then, but a running cooldown is not
          interrupted.
        </p>
        <div className="space-y-4">
          {resourceTypes.map((rt) => {
            const discovered = discoveredShares[rt];
            const setting = settings[rt] ?? { enabled: true, share: discovered ?? 1 };
            const switchId = `external-load-${rt}`;
            return (
              <div key={rt} className="border rounded p-3 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-sm font-medium">
                    {rt}{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      ({resourcePool[rt]} resource{resourcePool[rt] === 1 ? "" : "s"})
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <Switch
                      id={switchId}
                      checked={setting.enabled}
                      onCheckedChange={(enabled) => onChange(rt, { ...setting, enabled })}
                    />
                    <Label htmlFor={switchId} className="text-xs">
                      Consider external load
                    </Label>
                  </div>
                </div>

                {discovered === undefined ? (
                  <p className="text-[10px] text-muted-foreground">
                    No events of this type in the log, so there is no evidence about
                    its external load. Default: no external load (share 1.0).
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    Discovered: {pct(discovered)} of its events inside the process
                    area, {pct(1 - discovered)} outside (external load).
                  </p>
                )}

                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-muted-foreground w-36">
                    Process-area capacity share
                  </span>
                  <Slider
                    className="flex-1 min-w-32"
                    value={[setting.share]}
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={!setting.enabled}
                    onValueChange={([v]) => onChange(rt, { ...setting, share: clampShare(v) })}
                  />
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={setting.share}
                    disabled={!setting.enabled}
                    onChange={(e) =>
                      onChange(rt, {
                        ...setting,
                        share: clampShare(parseFloat(e.target.value) || 0),
                      })
                    }
                    className="h-6 w-20 text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    disabled={!setting.enabled || setting.share === (discovered ?? 1)}
                    onClick={() => onChange(rt, { ...setting, share: discovered ?? 1 })}
                  >
                    Reset to discovered
                  </Button>
                </div>
                {!setting.enabled && (
                  <p className="text-[10px] text-muted-foreground">
                    External load off: the process area gets the full capacity (share 1.0).
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default ExternalLoadEditor;
