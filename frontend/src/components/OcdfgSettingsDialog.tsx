/**
 * The OCDFG widgets' settings popup body (OCDFG and OCDFG with variants):
 * the settings their edit forms always had beside a draft of the graph. It
 * works on a draft of the settings, mounted on every open, and only hands it
 * over on Apply. The layout (direction included) is changed with the layout
 * button in the widget's toolbar and stored with the widget, not here.
 */

import React, { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ChartSettingsLayout } from "./sql-widgets/chartSettings";
import OcdfgSketch from "./OcdfgSketch";

type OcdfgSettings = {
  showControls: boolean;
  initialInteractionLocked: boolean;
};

const OcdfgSettingsBody: React.FC<{
  id: string;
  heading: string;
  /** The widget's one-line description at the top of the form. */
  description: string;
  initial: OcdfgSettings;
  /** Direction the draft is drawn in (the widget's default direction). */
  layoutDirection: "TB" | "LR";
  /** Explanation of the draft, the same as in the edit tile. */
  sketchHint: string;
  onApply: (settings: OcdfgSettings) => void;
  onCancel: () => void;
}> = ({ id, heading, description, initial, layoutDirection, sketchHint, onApply, onCancel }) => {
  const [showControls, setShowControls] = useState(initial.showControls);
  const [initialInteractionLocked, setInitialInteractionLocked] = useState(initial.initialInteractionLocked);

  return (
    <ChartSettingsLayout
      heading={heading}
      idPrefix={id}
      onApply={() => onApply({ showControls, initialInteractionLocked })}
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
          <p className="text-xs text-muted-foreground">
            The layout is changed with the layout button in the widget&apos;s toolbar and stored with this widget.
          </p>
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
