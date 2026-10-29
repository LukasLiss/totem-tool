/**
 * BarChartSketch — a wireframe of the bar chart widget for its edit tile and
 * settings popup. It only shows the layout the settings produce (title,
 * vertical or horizontal bars, values on the bars, colors), with placeholder
 * shapes instead of real labels and numbers.
 */

import React from "react";
import { cn } from "@/lib/utils";

const WIDTH = 240;
const HEIGHT = 190;
// Fixed bar lengths for the sketch, as a share of the longest, largest first.
const SHARES = [1, 0.74, 0.58, 0.43, 0.3];
// Placeholder label lengths per bar, so the axis doesn't look uniform.
const LABEL_LENGTHS = [22, 16, 26, 14, 20];
const VALUE_LENGTH = 10;
const INK = "var(--muted-foreground)";

/** Placeholder for a line of text. */
const TextBar = ({ x, y, width, height = 4, opacity = 0.3 }: {
  x: number;
  y: number;
  width: number;
  height?: number;
  opacity?: number;
}) => <rect x={x} y={y - height / 2} width={width} height={height} rx={height / 2} fill={INK} opacity={opacity} />;

interface BarChartSketchProps {
  /** The real chart title, shown as text; empty means no title. */
  title: string;
  horizontal: boolean;
  showValues: boolean;
  /** Colors of the five sketch bars; grey when omitted. */
  colors?: string[];
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}

// Longer titles are cut off with an ellipsis so they fit the sketch width.
const TITLE_MAX_CHARS = 40;

const BarChartSketch: React.FC<BarChartSketchProps> = ({ title, horizontal, showValues, colors, className }) => {
  const showTitle = title.trim() !== "";
  const shortTitle = title.length > TITLE_MAX_CHARS ? `${title.slice(0, TITLE_MAX_CHARS - 1)}…` : title;
  const fill = (i: number) => colors?.[i] ?? INK;
  const fillOpacity = colors?.[0] ? 1 : 0.55;

  // The bars use about the same area as the pie chart sketch's pie and
  // legend, so both sketches look alike in size.
  const top = showTitle ? 24 : 14;
  const bottom = HEIGHT - 14;
  const left = 30;
  const right = WIDTH - 30;

  const bars = horizontal
    ? (() => {
        // Labels in a column on the left, bars growing to the right.
        const labelWidth = Math.max(...LABEL_LENGTHS) + 6;
        const x0 = left + labelWidth;
        const maxLength = right - x0 - (showValues ? VALUE_LENGTH + 4 : 0);
        const slot = (bottom - top) / SHARES.length;
        const thickness = slot * 0.6;
        return (
          <>
            {/* The axis the bars start from, like the baseline of the vertical view. */}
            <line x1={x0} x2={x0} y1={top} y2={bottom} stroke={INK} strokeOpacity={0.4} strokeWidth={0.75} />
            {SHARES.map((share, i) => {
              const y = top + i * slot + (slot - thickness) / 2;
              const length = maxLength * share;
              return (
                <g key={i}>
                  <TextBar x={x0 - 4 - LABEL_LENGTHS[i]} y={y + thickness / 2} width={LABEL_LENGTHS[i]} />
                  <rect x={x0} y={y} width={length} height={thickness} rx={1.5} fill={fill(i)} fillOpacity={fillOpacity} />
                  {showValues && (
                    <TextBar x={x0 + length + 3} y={y + thickness / 2} width={VALUE_LENGTH} opacity={0.18} />
                  )}
                </g>
              );
            })}
          </>
        );
      })()
    : (() => {
        // Bars standing on a baseline, a label below each one.
        const baseline = bottom - 10;
        const maxLength = baseline - top - (showValues ? 8 : 0);
        const slot = (right - left) / SHARES.length;
        const thickness = slot * 0.55;
        return (
          <>
            <line x1={left} x2={right} y1={baseline} y2={baseline} stroke={INK} strokeOpacity={0.4} strokeWidth={0.75} />
            {SHARES.map((share, i) => {
              const x = left + i * slot + (slot - thickness) / 2;
              const length = maxLength * share;
              const center = x + thickness / 2;
              const labelWidth = Math.min(LABEL_LENGTHS[i], slot - 4);
              return (
                <g key={i}>
                  <rect
                    x={x}
                    y={baseline - length}
                    width={thickness}
                    height={length}
                    rx={1.5}
                    fill={fill(i)}
                    fillOpacity={fillOpacity}
                  />
                  {showValues && (
                    <TextBar x={center - VALUE_LENGTH / 2} y={baseline - length - 5} width={VALUE_LENGTH} opacity={0.18} />
                  )}
                  <TextBar x={center - labelWidth / 2} y={baseline + 6} width={labelWidth} />
                </g>
              );
            })}
          </>
        );
      })();

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("mx-auto block", className ?? "w-full max-w-sm")}
      role="img"
      aria-label="Layout sketch of the bar chart"
    >
      {showTitle && (
        <text x={WIDTH / 2} y={9} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={600} fill="var(--foreground)">
          <title>{title}</title>
          {shortTitle}
        </text>
      )}
      {bars}
    </svg>
  );
};

export default BarChartSketch;
