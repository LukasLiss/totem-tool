/**
 * VerticalAxisLabel — the rotated title of a chart's y axis, passed to
 * Recharts as `label={{ content: ... }}`. Centered along the axis, shortened
 * with "…" when longer than the axis, and the full text shown on hover.
 */

import React from "react";
import type { CartesianViewBox } from "recharts";

// Same grey and distance from the edge as Recharts' own axis labels.
const LABEL_FILL = "#808080";
const EDGE_OFFSET = 5;
// Room left free at both ends of the axis.
const END_PADDING = 4;

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Width of `text` in px at `fontSize`, in the page's font. */
function textWidth(text: string, fontSize: number): number {
  if (measureContext === undefined) {
    measureContext = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  }
  if (!measureContext) return text.length * fontSize * 0.6;
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  measureContext.font = `${fontSize}px ${family}`;
  return measureContext.measureText(text).width;
}

/** `text` cut with "…" so that it fits into `maxWidth` px. */
function fitText(text: string, fontSize: number, maxWidth: number): string {
  if (textWidth(text, fontSize) <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (textWidth(`${text.slice(0, mid).trimEnd()}…`, fontSize) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? `${text.slice(0, low).trimEnd()}…` : "…";
}

interface VerticalAxisLabelProps {
  text: string;
  fontSize?: number;
  /** The y axis' box, handed in by Recharts (always cartesian here). */
  viewBox?: object;
}

const VerticalAxisLabel: React.FC<VerticalAxisLabelProps> = ({ text, fontSize = 11, viewBox }) => {
  const { x = 0, y = 0, height = 0 } = (viewBox ?? {}) as CartesianViewBox;
  if (height <= 0) return null;
  const cx = x + EDGE_OFFSET + fontSize / 2;
  const cy = y + height / 2;
  const shown = fitText(text, fontSize, Math.max(0, height - 2 * END_PADDING));
  return (
    <text
      className="recharts-label"
      x={cx}
      y={cy}
      transform={`rotate(-90 ${cx} ${cy})`}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={fontSize}
      fill={LABEL_FILL}
    >
      <title>{text}</title>
      {shown}
    </text>
  );
};

export default VerticalAxisLabel;
