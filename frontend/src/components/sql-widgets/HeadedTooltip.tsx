/**
 * HeadedTooltip — the tooltip of the bar chart and scatter plot: one top
 * row with the hovered item's color and name (the bar's category, the
 * point's series), then its values (bar value; x and y) without color
 * squares, so the color shows once. Passed as `<ChartTooltip content={...} />`;
 * Recharts fills in `active` and `payload`.
 */

import React from "react";

/** One tooltip row as Recharts hands it over. */
interface TooltipEntry {
  name?: unknown;
  value?: unknown;
  type?: string;
  /** The hovered data item (bar or point). */
  payload?: Record<string, unknown>;
}

export interface TooltipHeading {
  label: string;
  color?: string;
  /** Shown on the right of the top row, e.g. a point's value in the color column. */
  value?: unknown;
}

const formatValue = (value: unknown) =>
  typeof value === "number" ? value.toLocaleString() : String(value);

const HeadedTooltip: React.FC<{
  active?: boolean;
  payload?: readonly TooltipEntry[];
  /** The top row for the hovered item; none when it returns null. */
  heading: (item: Record<string, unknown>) => TooltipHeading | null;
}> = ({ active, payload, heading }) => {
  const entries = (payload ?? []).filter((entry) => entry.type !== "none");
  if (!active || entries.length === 0) return null;
  const head = heading(entries[0].payload ?? {});

  return (
    // Left-aligned explicitly (the chart around it may center text); a normal
    // line height, so `truncate` doesn't clip descenders like g, p, y.
    <div className="grid min-w-[8rem] max-w-[24rem] gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-left text-xs leading-normal shadow-xl">
      {head && (
        <div className="flex items-center gap-2">
          {head.color && (
            <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: head.color }} />
          )}
          <span className="min-w-0 flex-1 truncate font-medium" title={head.label}>
            {head.label}
          </span>
          {head.value != null && (
            <span className="font-mono font-medium tabular-nums">{formatValue(head.value)}</span>
          )}
        </div>
      )}
      {entries.map((entry, index) => {
        const name = String(entry.name ?? "");
        return (
          <div key={index} className="flex items-center justify-between gap-4">
            <span className="min-w-0 truncate text-muted-foreground" title={name}>
              {name}
            </span>
            {entry.value != null && (
              <span className="font-mono font-medium text-foreground tabular-nums">{formatValue(entry.value)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default HeadedTooltip;
