/**
 * The OCDFG widgets' settings popup body (OCDFG and OCDFG with variants):
 * the settings their edit forms always had beside a draft of the graph. It
 * works on a draft of the settings, mounted on every open, and only hands it
 * over on Apply.
 */

import React, { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ChartSettingsLayout } from "./sql-widgets/chartSettings";
import { SegmentedControl } from "./sql-widgets/shared";
import OcdfgSketch from "./OcdfgSketch";

const LAYOUT_DIRECTION_OPTIONS: readonly { value: "TB" | "LR"; label: string }[] = [
  { value: "TB", label: "Top to Bottom" },
  { value: "LR", label: "Left to Right" },
];

type OcdfgSettings = {
  showControls: boolean;
  initialInteractionLocked: boolean;
  layoutDirection: "TB" | "LR";
};

const OcdfgSettingsBody: React.FC<{
  id: string;
  heading: string;
  /** The widget's one-line description at the top of the form. */
  description: string;
  initial: OcdfgSettings;
  /** Explanation of the draft, the same as in the edit tile. */
  sketchHint: string;
  onApply: (settings: OcdfgSettings) => void;
  onCancel: () => void;
}> = ({ id, heading, description, initial, sketchHint, onApply, onCancel }) => {
  const [showControls, setShowControls] = useState(initial.showControls);
  const [initialInteractionLocked, setInitialInteractionLocked] = useState(initial.initialInteractionLocked);
  const [layoutDirection, setLayoutDirection] = useState(initial.layoutDirection);

  return (
    <ChartSettingsLayout
      heading={heading}
      idPrefix={id}
      onApply={() => onApply({ showControls, initialInteractionLocked, layoutDirection })}
      onCancel={onCancel}
      dataTab={
        <div className="space-y-4 text-left">
          <p className="text-sm text-muted-foreground">{description}</p>
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
        <OcdfgSketch
          layoutDirection={layoutDirection}
          showControls={showControls}
          interactionLocked={initialInteractionLocked}
          className="w-full max-w-xs md:max-w-md"
        />
      }
      sketchHint={sketchHint}
    />
  );
};

export default OcdfgSettingsBody;
