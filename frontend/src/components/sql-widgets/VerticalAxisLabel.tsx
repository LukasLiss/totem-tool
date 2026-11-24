/**
 * VerticalAxisLabel — the rotated title of a chart's y axis, passed to
 * Recharts as `label={{ content: ... }}`. Centered along the axis, shortened
 * with "…" when longer than the axis, and the full text shown on hover.
 */

import React from "react";
import type { CartesianViewBox } from "recharts";
import { fitText } from "./textMeasure";

// Same grey and distance from the edge as Recharts' own axis labels.
const LABEL_FILL = "#808080";
const EDGE_OFFSET = 5;
// Room left free at both ends of the axis.
const END_PADDING = 4;

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
