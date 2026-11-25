/**
 * The OCDFG widgets' settings popup body (OCDFG and OCDFG with variants):
 * the settings their edit forms always had beside a draft of the graph. It
 * works on a draft of the settings, mounted on every open, and only hands it
 * over on Apply. The flow direction set here is the one the widget opens
 * with. The arc labels and arc strength are layout options: set here or in
 * the layout panel of the widget's toolbar, they are stored with the widget
 * either way, like the rest of the layout.
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

export type OcdfgSettings = {
  showControls: boolean;
  initialInteractionLocked: boolean;
  layoutDirection: "TB" | "LR";
  /** "Frequency labels on arcs" of the layout options. */
  frequencyLabels: boolean;
  /** "Arc strength by duration" of the layout options. */
  durationShade: boolean;
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
  const [frequencyLabels, setFrequencyLabels] = useState(initial.frequencyLabels);
  const [durationShade, setDurationShade] = useState(initial.durationShade);

  return (
    <ChartSettingsLayout
      heading={heading}
      idPrefix={id}
      onApply={() =>
        onApply({ showControls, initialInteractionLocked, layoutDirection, frequencyLabels, durationShade })
      }
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
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Flow direction</Label>
              <SegmentedControl<"TB" | "LR">
                ariaLabel="Flow direction"
                value={layoutDirection}
                options={LAYOUT_DIRECTION_OPTIONS}
                onChange={setLayoutDirection}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The direction the graph opens with. Changing it in the layout panel of the
              widget&apos;s toolbar applies while the dashboard is open; the next time the
              graph is shown, it starts in this direction again.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`${id}-frequency-labels`}>Frequency labels on arcs</Label>
            <Switch
              id={`${id}-frequency-labels`}
              checked={frequencyLabels}
              onCheckedChange={setFrequencyLabels}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${id}-duration-shade`}>Arc strength by duration</Label>
              <Switch
                id={`${id}-duration-shade`}
                checked={durationShade}
                onCheckedChange={setDurationShade}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Each arc keeps its object type&apos;s color; the slower its average time, the
              stronger it is drawn (faint = fast, strong = slow), as in the handover graph.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Both can also be switched in the layout panel of the widget&apos;s toolbar. The rest of
            the layout is changed there and stored with this widget.
          </p>
        </div>
      }
      sketch={
        <OcdfgSketch
          layoutDirection={layoutDirection}
          showControls={showControls}
          interactionLocked={initialInteractionLocked}
          frequencyLabels={frequencyLabels}
          durationShade={durationShade}
          className="w-full max-w-xs md:max-w-md"
        />
      }
      sketchHint={sketchHint}
    />
  );
};

export default OcdfgSettingsBody;
