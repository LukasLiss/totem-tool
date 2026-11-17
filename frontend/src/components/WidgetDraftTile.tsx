/**
 * WidgetDraftTile — what a dashboard widget shows in edit mode instead of
 * its settings form: the widget type in the corner, a sketch of the layout
 * its settings produce, and a small "Double-click to edit" note; a
 * double-click (or Enter / Space while the tile has focus) opens the
 * widget's settings popup. The widget supplies the sketch (an SVG that fills
 * the space it is given) and renders its popup as `children`.
 */

import React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Shown when hovering the sketch, unless the widget passes its own `hint`.
const DEFAULT_HINT =
  "Layout preview: shows how your settings arrange this component. Grey bars stand in for " +
  "real content; the real data is shown when you leave edit mode.";

const WidgetDraftTile: React.FC<{
  /** The widget type, e.g. "Bar chart". */
  typeLabel: string;
  /** The layout sketch; it should fill its box (e.g. `h-full w-full`). */
  sketch: React.ReactNode;
  /** A short note above "Double-click to edit", e.g. that nothing is configured yet. */
  notice?: string;
  hint?: string;
  /**
   * Max width of the sketch (a Tailwind class); `max-w-md` keeps sketches
   * alike in size. Wide widgets (e.g. a row of cards) may allow more.
   */
  sketchMaxWidth?: string;
  /** Opens the settings popup; without it (a widget with no settings) the tile is a plain draft. */
  onConfigure?: () => void;
  /** The settings popup, rendered alongside. */
  children?: React.ReactNode;
}> = ({ typeLabel, sketch, notice, hint = DEFAULT_HINT, sketchMaxWidth = "max-w-md", onConfigure, children }) => (
  <Card
    className="flex h-full w-full flex-col gap-0 overflow-hidden rounded-none py-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    {...(onConfigure && {
      onDoubleClick: onConfigure,
      tabIndex: 0,
      role: "button",
      "aria-label": `Edit ${typeLabel}`,
      onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
        // Only keys on the tile itself; the popup's events bubble up here through React.
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onConfigure();
        }
      },
    })}
  >
    <div className="px-3 pt-2 text-left">
      <span className="block truncate text-xs font-medium text-muted-foreground">{typeLabel}</span>
    </div>
    {/* Capped, so sketches look alike in size side by side and don't grow huge in big tiles. */}
    <div className={cn("mx-auto min-h-0 w-full flex-1 px-3", sketchMaxWidth)} title={hint}>
      {sketch}
    </div>
    <div className="flex flex-col items-center gap-0.5 px-3 pt-1 pb-2 text-center text-xs text-muted-foreground">
      {notice && <p>{notice}</p>}
      {onConfigure && <p>Double-click to edit</p>}
    </div>
    {children}
  </Card>
);

export default WidgetDraftTile;
