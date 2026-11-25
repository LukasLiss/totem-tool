/**
 * LogStatisticsSketch — a draft of the log statistics widget for its edit
 * tile and settings popup: one card per selected statistic, each with its
 * real label and a grey bar standing in for the value. The cards wrap into
 * rows like the widget (see bestStatColumns): one row in a wide box,
 * several in a tall one, with the cards of a shorter last row stretching.
 */

import React from "react";
import { cn } from "@/lib/utils";
import {
  LOG_STATISTICS,
  STAT_GRID,
  bestStatColumns,
  statGridSize,
  useElementSize,
  type LogStatisticsSelection,
} from "./logStatisticsUtils";

const { padding: PADDING, gap: GAP, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT } = STAT_GRID;
const LABEL_MAX_SIZE = 7;
// Rough average glyph width as a share of the font size, for fitting without measuring.
const GLYPH_WIDTH = 0.55;
const INK = "var(--muted-foreground)";

const LogStatisticsSketch: React.FC<{
  selection: LogStatisticsSelection;
  /** Size of the sketch's box; it needs a height (e.g. `h-full` or an aspect ratio) to wrap well. */
  className?: string;
}> = ({ selection, className }) => {
  const shown = LOG_STATISTICS.filter((stat) => selection[stat.key]);

  // The box's size decides how the cards wrap.
  const box = useElementSize();
  const columns = bestStatColumns(shown.length, box.width, box.height);
  const rows = Math.max(1, Math.ceil(shown.length / columns));
  const grid = statGridSize(columns, rows);
  // One label size for all cards, small enough for the longest label.
  const longestLabel = Math.max(1, ...shown.map((stat) => stat.label.length));
  const labelSize = Math.min(LABEL_MAX_SIZE, (CARD_WIDTH - 6) / (longestLabel * GLYPH_WIDTH));
  const inner = grid.width - PADDING * 2;

  return (
    <div ref={box.ref} className={cn("mx-auto", className ?? "aspect-[4/3] w-full max-w-sm")}>
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
            // Cards in the last row share its whole width, as in the widget.
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
