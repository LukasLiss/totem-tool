/**
 * WidgetDraftTile — what a dashboard widget shows in edit mode instead of
 * its settings form: the widget type in the corner, a sketch of the layout
 * its settings produce, and a Configure button (or a double-click) that
 * opens the widget's settings popup. The widget supplies the sketch (an SVG
 * that fills the space it is given) and renders its popup as `children`.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Shown when hovering the sketch, unless the widget passes its own `hint`.
const DEFAULT_HINT =
  "Layout preview: shows how your settings arrange this component. Grey bars stand in for " +
  "real content; the real data is shown when you leave edit mode.";

const WidgetDraftTile: React.FC<{
  /** The widget type, e.g. "Bar chart". */
  typeLabel: string;
  /** The layout sketch; it should fill its box (e.g. `h-full w-full`). */
  sketch: React.ReactNode;
  /** A short note above the button, e.g. that nothing is configured yet. */
  notice?: string;
  hint?: string;
  onConfigure: () => void;
  /** The settings popup, rendered alongside. */
  children?: React.ReactNode;
}> = ({ typeLabel, sketch, notice, hint = DEFAULT_HINT, onConfigure, children }) => (
  <Card className="flex h-full w-full flex-col gap-0 overflow-hidden rounded-none py-0" onDoubleClick={onConfigure}>
    <div className="px-3 pt-2 text-left">
      <span className="block truncate text-xs font-medium text-muted-foreground">{typeLabel}</span>
    </div>
    {/* Capped, so sketches look alike in size side by side and don't grow huge in big tiles. */}
    <div className="mx-auto min-h-0 w-full max-w-md flex-1 px-3" title={hint}>
      {sketch}
    </div>
    <div className="flex flex-col items-center gap-1.5 px-3 pt-1 pb-3">
      {notice && <p className="text-center text-xs text-muted-foreground">{notice}</p>}
      <Button type="button" size="sm" variant="outline" onClick={onConfigure}>
        Configure
      </Button>
    </div>
    {children}
  </Card>
);

export default WidgetDraftTile;
