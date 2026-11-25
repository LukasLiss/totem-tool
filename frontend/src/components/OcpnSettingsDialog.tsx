/**
 * The OCPN widget's settings popup body: automatic discovery and the
 * discovery timeout (the settings the edit form always had) beside a draft
 * of the net. It works on a draft of the settings, mounted on every open, and
 * only hands it over on Apply.
 */

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ChartSettingsLayout } from "./sql-widgets/chartSettings";
import OcpnSketch from "./OcpnSketch";

type OcpnSettings = { automaticLoading: boolean; timeoutS: number };

const OcpnSettingsBody: React.FC<{
  id: string;
  initial: OcpnSettings;
  /** Explanation of the draft, the same as in the edit tile. */
  sketchHint: string;
  onApply: (settings: OcpnSettings) => void;
  onCancel: () => void;
}> = ({ id, initial, sketchHint, onApply, onCancel }) => {
  const [automaticLoading, setAutomaticLoading] = useState(initial.automaticLoading);
  const [timeoutS, setTimeoutS] = useState(initial.timeoutS);

  return (
    <ChartSettingsLayout
      heading="OC Petri net settings"
      idPrefix={id}
      onApply={() => onApply({ automaticLoading, timeoutS })}
      onCancel={onCancel}
      dataTab={
        <div className="space-y-4 text-left">
          <p className="text-sm text-muted-foreground">
            Discovers an Object-Centric Petri Net from the selected event log.
          </p>
          {/* Automatic loading */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor={`${id}-auto-loading`}>Start discovery automatically</Label>
              <p className="text-xs text-muted-foreground">
                Run OCPN discovery as soon as the dashboard loads.
              </p>
            </div>
            <Switch
              id={`${id}-auto-loading`}
              checked={automaticLoading}
              onCheckedChange={setAutomaticLoading}
            />
          </div>

          {/* Timeout (seconds) */}
          <div className="space-y-2">
            <Label htmlFor={`${id}-timeout-setting`}>Timeout (seconds)</Label>
            <Input
              id={`${id}-timeout-setting`}
              type="number"
              min={1}
              max={600}
              step={1}
              value={timeoutS}
              onChange={(e) => {
                // The same rule the edit form applied: anything but a positive number is 30.
                const n = Number(e.target.value);
                setTimeoutS(Number.isFinite(n) && n > 0 ? n : 30);
              }}
              className="w-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              Wall-clock budget for the discovery. Increase it for large logs.
            </p>
          </div>
        </div>
      }
      sketch={<OcpnSketch className="w-full max-w-xs md:max-w-md" />}
      sketchHint={sketchHint}
    />
  );
};

export default OcpnSettingsBody;
