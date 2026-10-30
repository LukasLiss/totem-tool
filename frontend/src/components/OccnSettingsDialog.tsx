/**
 * The OCCN widget's settings popup body: the settings its edit form always
 * had beside a draft of the causal net. It works on a draft of the settings,
 * mounted on every open, and only hands it over on Apply.
 */

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ChartSettingsLayout } from "./sql-widgets/chartSettings";
import { SegmentedControl } from "./sql-widgets/shared";
import OccnSketch from "./OccnSketch";

const LAYOUT_DIRECTION_OPTIONS: readonly { value: "TB" | "LR"; label: string }[] = [
  { value: "TB", label: "Top to Bottom" },
  { value: "LR", label: "Left to Right" },
];

type OccnSettings = {
  threshold: number;
  objectTypes: string;
  showControls: boolean;
  initialInteractionLocked: boolean;
  layoutDirection: "TB" | "LR";
};

const OccnSettingsBody: React.FC<{
  id: string;
  initial: OccnSettings;
  /** Explanation of the draft, the same as in the edit tile. */
  sketchHint: string;
  onApply: (settings: OccnSettings) => void;
  onCancel: () => void;
}> = ({ id, initial, sketchHint, onApply, onCancel }) => {
  const [threshold, setThreshold] = useState(initial.threshold);
  const [objectTypes, setObjectTypes] = useState(initial.objectTypes);
  const [showControls, setShowControls] = useState(initial.showControls);
  const [initialInteractionLocked, setInitialInteractionLocked] = useState(initial.initialInteractionLocked);
  const [layoutDirection, setLayoutDirection] = useState(initial.layoutDirection);

  return (
    <ChartSettingsLayout
      heading="OCCN settings"
      idPrefix={id}
      onApply={() => onApply({ threshold, objectTypes, showControls, initialInteractionLocked, layoutDirection })}
      onCancel={onCancel}
      dataTab={
        <div className="space-y-4 text-left">
          <p className="text-sm text-muted-foreground">
            Object-Centric Causal Net (OCCN) with activity bindings and automatic ELK layout.
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${id}-threshold`}>Frequency Threshold</Label>
              <span className="text-sm text-muted-foreground">{threshold.toFixed(2)}</span>
            </div>
            <Slider
              id={`${id}-threshold`}
              min={0}
              max={1}
              step={0.05}
              value={[threshold]}
              onValueChange={(value) => setThreshold(value[0] ?? 0)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-object-types`}>Object Type Filter</Label>
            <Input
              id={`${id}-object-types`}
              value={objectTypes}
              onChange={(e) => setObjectTypes(e.target.value)}
              placeholder="e.g. orders, items (empty = all types)"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated object types to include; leave empty to use all.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`${id}-show-controls`}>Show Controls Panel</Label>
            <Switch
              id={`${id}-show-controls`}
              checked={showControls}
              onCheckedChange={setShowControls}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`${id}-initial-locked`}>Lock Interactions Initially</Label>
            <Switch
              id={`${id}-initial-locked`}
              checked={initialInteractionLocked}
              onCheckedChange={setInitialInteractionLocked}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Layout Direction</Label>
            <SegmentedControl<"TB" | "LR">
              ariaLabel="Layout direction"
              value={layoutDirection}
              options={LAYOUT_DIRECTION_OPTIONS}
              onChange={setLayoutDirection}
            />
          </div>
        </div>
      }
      sketch={
        <OccnSketch
          layoutDirection={layoutDirection}
          showControls={showControls}
          interactionLocked={initialInteractionLocked}
          threshold={threshold}
          className="w-full max-w-xs md:max-w-md"
        />
      }
      sketchHint={sketchHint}
    />
  );
};

export default OccnSettingsBody;
