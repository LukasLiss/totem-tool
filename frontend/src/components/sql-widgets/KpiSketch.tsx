/**
 * KpiSketch — a draft of the KPI widget for its edit tile and settings
 * popup: the real title, prefix and suffix around the number. That is the
 * query's real value when the popup has loaded it, else a sample number
 * formatted with the chosen decimals, drawn faded since it only stands in.
 */

import React, { useRef } from "react";
import { cn } from "@/lib/utils";
import { useSvgUnitsPerPixel } from "@/components/sketchScale";
import { kpiSampleNumber, type KpiSize } from "./kpiUtils";

const WIDTH = 240;
const HEIGHT = 120;
const NUMBER_MAX_SIZE = 40;
// Prefix / suffix size relative to the number (text-lg next to the large number).
const AFFIX_SHARE = 0.45;
// Rough average glyph width as a share of the font size, for fitting without measuring.
const GLYPH_WIDTH = 0.58;
const TITLE_MAX_CHARS = 40;
const INK = "var(--muted-foreground)";

interface KpiSketchProps {
  /** The real title, shown as text; empty means no title. */
  title: string;
  prefix: string;
  suffix: string;
  decimals: number;
  /** The real value, already formatted; the sample number is shown without it. */
  value?: string;
  /** The column `value` was read from, shown below the number when there is no title. */
  column?: string;
  /**
   * The widget's size step (edit tile): the number is drawn at that size on
   * screen, so a small card shows a small number like the widget. Without
   * it (settings popup) the number fills the sketch's width.
   */
  size?: KpiSize;
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}

const KpiSketch: React.FC<KpiSketchProps> = ({ title, prefix, suffix, decimals, value, column, size: step, className }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const unitsPerPixel = useSvgUnitsPerPixel(svgRef, WIDTH, HEIGHT);
  const showTitle = title.trim() !== "";
  const shortTitle = title.length > TITLE_MAX_CHARS ? `${title.slice(0, TITLE_MAX_CHARS - 1)}…` : title;
  const isReal = value != null;
  const number = value ?? kpiSampleNumber(decimals);

  // Shrink the line so prefix, number and suffix fit the width.
  const gap = 0.25;
  const units =
    number.length * GLYPH_WIDTH +
    (prefix.length + suffix.length) * GLYPH_WIDTH * AFFIX_SHARE +
    (prefix ? gap : 0) +
    (suffix ? gap : 0);
  const fitWidth = (WIDTH - 20) / units;
  // With the widget's size step: its on-screen size in sketch units, only kept inside the sketch
  // (width, and half its height so the title still fits). Without: fill the width, at most 40.
  const size = step
    ? Math.min(fitWidth, HEIGHT * 0.5, step.number * unitsPerPixel)
    : Math.min(NUMBER_MAX_SIZE, fitWidth);
  const affixSize = size * (step ? step.affix / step.number : AFFIX_SHARE);
  const centerY = showTitle ? 66 : 56;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("mx-auto block", className ?? "w-full max-w-sm")}
      role="img"
      aria-label="Layout sketch of the KPI"
    >
      {showTitle && (
        // Like the widget: a small muted title above the number.
        <text x={WIDTH / 2} y={14} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={500} fill={INK}>
          <title>{title}</title>
          {shortTitle}
        </text>
      )}
      {/* One line, all parts on the same baseline, like the widget's number row. */}
      <text x={WIDTH / 2} y={centerY} dy="0.35em" textAnchor="middle" fontSize={size}>
        {prefix && (
          <tspan fontSize={affixSize} fill={INK}>
            {prefix}
          </tspan>
        )}
        <tspan
          dx={prefix ? size * gap : 0}
          fontWeight={600}
          fill="var(--foreground)"
          fillOpacity={isReal ? 1 : 0.45}
        >
          {number}
        </tspan>
        {suffix && (
          <tspan dx={size * gap} fontSize={affixSize} fill={INK}>
            {suffix}
          </tspan>
        )}
      </text>
      {/* Without a title the widget names the value column below the number. */}
      {!showTitle &&
        (column ? (
          <text
            x={WIDTH / 2}
            y={centerY + size * 0.6 + 8}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={8}
            fontFamily="ui-monospace, monospace"
            fill={INK}
          >
            {column}
          </text>
        ) : (
          <rect x={WIDTH / 2 - 18} y={centerY + size * 0.6 + 6} width={36} height={4} rx={2} fill={INK} opacity={0.3} />
        ))}
    </svg>
  );
};

export default KpiSketch;
