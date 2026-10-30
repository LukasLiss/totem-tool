/**
 * LogStatisticsSketch — a draft of the log statistics widget for its edit
 * tile and settings popup: one card per selected statistic, each with its
 * real label and a grey bar standing in for the value. The cards keep the
 * widget's wide, low shape and wrap into as many rows as fit the space best:
 * one row in a wide tile, several in a tall one (cards in the last row
 * stretch, as flex-1 does in the widget).
 */

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { LOG_STATISTICS, type LogStatisticsSelection } from "./logStatisticsUtils";

const PADDING = 8;
const GAP = 6;
// One card in drawing units: wide and low, about 3:1.
const CARD_WIDTH = 104;
const CARD_HEIGHT = 34;
const LABEL_MAX_SIZE = 7;
// Rough average glyph width as a share of the font size, for fitting without measuring.
const GLYPH_WIDTH = 0.55;
// Without a measured size (yet): at most this many cards per row.
const DEFAULT_COLUMNS = 4;
const INK = "var(--muted-foreground)";

const gridSize = (columns: number, rows: number) => ({
  width: PADDING * 2 + columns * CARD_WIDTH + (columns - 1) * GAP,
  height: PADDING * 2 + rows * CARD_HEIGHT + (rows - 1) * GAP,
});

/**
 * The number of columns at which the cards come out largest in a `width` x
 * `height` box. Only evenly filled rows are tried (7 cards: 7, 4 + 3, 3 + 3
 * + 1, …), so no row ends with a single stray card; ties go to fewer rows,
 * the widget's usual wide shape.
 */
function bestColumns(count: number, width: number, height: number): number {
  if (count === 0 || width <= 0 || height <= 0) return Math.min(count, DEFAULT_COLUMNS) || 1;
  let best = count;
  let bestScale = 0;
  for (let rows = 1; rows <= count; rows++) {
    const columns = Math.ceil(count / rows);
    const grid = gridSize(columns, Math.ceil(count / columns));
    const scale = Math.min(width / grid.width, height / grid.height);
    if (scale > bestScale) {
      best = columns;
      bestScale = scale;
    }
  }
  return best;
}

const LogStatisticsSketch: React.FC<{
  selection: LogStatisticsSelection;
  /** Size of the sketch's box; it needs a height (e.g. `h-full` or an aspect ratio) to wrap well. */
  className?: string;
}> = ({ selection, className }) => {
  const shown = LOG_STATISTICS.filter((stat) => selection[stat.key]);

  // The box's size decides how the cards wrap.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [box]);

  const columns = bestColumns(shown.length, size.width, size.height);
  const rows = Math.max(1, Math.ceil(shown.length / columns));
  const grid = gridSize(columns, rows);
  // One label size for all cards, small enough for the longest label.
  const longestLabel = Math.max(1, ...shown.map((stat) => stat.label.length));
  const labelSize = Math.min(LABEL_MAX_SIZE, (CARD_WIDTH - 6) / (longestLabel * GLYPH_WIDTH));
  const inner = grid.width - PADDING * 2;

  return (
    <div ref={setBox} className={cn("mx-auto", className ?? "aspect-[4/3] w-full max-w-sm")}>
      <svg
        viewBox={`0 0 ${grid.width} ${grid.height}`}
        className="block h-full w-full"
        role="img"
        aria-label="Layout sketch of the log statistics"
      >
        {shown.length === 0 ? (
          <text
            x={grid.width / 2}
            y={grid.height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={9}
            fill={INK}
          >
            No statistics selected
          </text>
        ) : (
          shown.map((stat, i) => {
            const row = Math.floor(i / columns);
            // Cards in the last row share its whole width, as flex-1 does in the widget.
            const inRow = Math.min(columns, shown.length - row * columns);
            const width = (inner - GAP * (inRow - 1)) / inRow;
            const x = PADDING + (i - row * columns) * (width + GAP);
            const y = PADDING + row * (CARD_HEIGHT + GAP);
            const valueWidth = Math.min(30, width * 0.6);
            return (
              <g key={stat.key}>
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={CARD_HEIGHT}
                  rx={5}
                  fill="var(--card)"
                  stroke="var(--border)"
                  strokeWidth={0.75}
                />
                {/* Label and value centered in the card, as in the widget. */}
                <text
                  x={x + width / 2}
                  y={y + 11}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={labelSize}
                  fill={INK}
                >
                  {stat.label}
                </text>
                <rect
                  x={x + (width - valueWidth) / 2}
                  y={y + 21}
                  width={valueWidth}
                  height={6}
                  rx={3}
                  fill={INK}
                  opacity={0.3}
                />
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
};

export default LogStatisticsSketch;
