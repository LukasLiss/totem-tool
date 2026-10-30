/**
 * SqlTableSketch — a draft of the SQL editor widget's result table for its
 * edit tile and settings popup, laid out like the view: a header bar with
 * the name (and a "linked" badge for a stored query) and the status badge,
 * the table with its column names (real ones once known, grey bars before),
 * placeholder rows filling the space, and the paging footer: the view loads
 * the rows a page (rows per page) at a time, the next page automatically as
 * soon as the end of the table is in view.
 */

import React from "react";
import { cn } from "@/lib/utils";

const WIDTH = 240;
const HEIGHT = 190;
const PADDING = 8;
const HEADER_BAR_HEIGHT = 24;
const COLUMN_HEADER_HEIGHT = 14;
const ROW_HEIGHT = 13;
const FOOTER_HEIGHT = 18;
// Columns drawn when the real ones aren't known yet, and at most when they are.
const PLACEHOLDER_COLUMNS = 3;
const MAX_COLUMNS = 5;
// Placeholder cell lengths (as a share of the cell width), varied per row and column.
const CELL_SHARES = [0.7, 0.45, 0.6, 0.35, 0.55, 0.5, 0.65, 0.4];
const NAME_MAX_CHARS = 36;
// Rough average glyph width as a share of the font size, for fitting without measuring.
const GLYPH_WIDTH = 0.6;
const INK = "var(--muted-foreground)";

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);

const SqlTableSketch: React.FC<{
  /** The table's name; the view shows "SQL query" without one. */
  name: string;
  /** A stored query is linked (the view shows a "linked" badge). */
  linked: boolean;
  /** The result's column names, when known; grey bars stand in otherwise. */
  columns?: string[];
  /** Rows loaded per step: per page while scrolling, and per "Load more". */
  rowsPerPage: number;
  /** Sizing of the SVG; defaults to the full width, at most `max-w-sm`. */
  className?: string;
}> = ({ name, linked, columns, rowsPerPage, className }) => {
  const title = name.trim() || "SQL query";
  const known = columns && columns.length > 0;
  const shownColumns = known ? columns.slice(0, MAX_COLUMNS) : [];
  const columnCount = known ? shownColumns.length : PLACEHOLDER_COLUMNS;
  const tableLeft = PADDING;
  const tableWidth = WIDTH - PADDING * 2;
  const cellWidth = tableWidth / columnCount;

  const tableTop = HEADER_BAR_HEIGHT + 6;
  const bodyTop = tableTop + COLUMN_HEADER_HEIGHT;
  const footerTop = HEIGHT - FOOTER_HEIGHT;
  // As in the view: pages of `rowsPerPage` rows keep loading automatically
  // while the end of the table is in view, so the table fills its space;
  // the rows loaded so far are a whole number of pages.
  const rows = Math.max(1, Math.floor((footerTop - bodyTop - 4) / ROW_HEIGHT));
  const loadedRows = Math.max(1, Math.ceil(rows / rowsPerPage)) * rowsPerPage;

  const footerText = `${loadedRows.toLocaleString()} rows loaded · more available`;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("mx-auto block", className ?? "w-full max-w-sm")}
      role="img"
      aria-label="Layout sketch of the SQL result table"
    >
      {/* Header bar: name, "linked" badge, status badge on the right. */}
      <text x={PADDING} y={HEADER_BAR_HEIGHT / 2} dominantBaseline="central" fontSize={9} fontWeight={600} fill="var(--foreground)">
        <title>{title}</title>
        {shorten(title, linked ? NAME_MAX_CHARS - 8 : NAME_MAX_CHARS)}
      </text>
      {linked && (
        <g>
          <rect x={WIDTH - PADDING - 54 - 30} y={HEADER_BAR_HEIGHT / 2 - 5} width={26} height={10} rx={3} fill="var(--muted)" />
          <text x={WIDTH - PADDING - 54 - 17} y={HEADER_BAR_HEIGHT / 2} textAnchor="middle" dominantBaseline="central" fontSize={5.5} fill={INK}>
            linked
          </text>
        </g>
      )}
      <rect
        x={WIDTH - PADDING - 50}
        y={HEADER_BAR_HEIGHT / 2 - 5}
        width={50}
        height={10}
        rx={3}
        fill="none"
        stroke="var(--border)"
        strokeWidth={0.75}
      />
      <rect x={WIDTH - PADDING - 44} y={HEADER_BAR_HEIGHT / 2 - 1.5} width={38} height={3} rx={1.5} fill={INK} opacity={0.3} />
      <line x1={0} x2={WIDTH} y1={HEADER_BAR_HEIGHT} y2={HEADER_BAR_HEIGHT} stroke="var(--border)" strokeWidth={0.75} />

      {/* Column header row: real names (monospace, like the view) or grey bars. */}
      <rect x={tableLeft} y={tableTop} width={tableWidth} height={COLUMN_HEADER_HEIGHT} fill="var(--muted)" />
      {Array.from({ length: columnCount }, (_, c) => {
        const x = tableLeft + c * cellWidth;
        const maxChars = Math.max(2, Math.floor((cellWidth - 8) / (6 * GLYPH_WIDTH)));
        return (
          <g key={c}>
            {c > 0 && (
              <line x1={x} x2={x} y1={tableTop} y2={bodyTop + rows * ROW_HEIGHT} stroke="var(--border)" strokeWidth={0.5} />
            )}
            {known ? (
              <text
                x={x + 5}
                y={tableTop + COLUMN_HEADER_HEIGHT / 2}
                dominantBaseline="central"
                fontSize={6}
                fontFamily="ui-monospace, monospace"
                fill={INK}
              >
                <title>{shownColumns[c]}</title>
                {shorten(shownColumns[c], maxChars)}
              </text>
            ) : (
              <rect x={x + 5} y={tableTop + COLUMN_HEADER_HEIGHT / 2 - 2} width={cellWidth * 0.45} height={4} rx={2} fill={INK} opacity={0.35} />
            )}
          </g>
        );
      })}

      {/* Rows: grey bars stand in for the values. */}
      {Array.from({ length: rows }, (_, r) => {
        const y = bodyTop + r * ROW_HEIGHT;
        return (
          <g key={r}>
            {Array.from({ length: columnCount }, (_, c) => (
              <rect
                key={c}
                x={tableLeft + c * cellWidth + 5}
                y={y + ROW_HEIGHT / 2 - 2}
                width={(cellWidth - 10) * CELL_SHARES[(r * 3 + c) % CELL_SHARES.length]}
                height={4}
                rx={2}
                fill={INK}
                opacity={0.22}
              />
            ))}
            <line
              x1={tableLeft}
              x2={tableLeft + tableWidth}
              y1={y + ROW_HEIGHT}
              y2={y + ROW_HEIGHT}
              stroke="var(--border)"
              strokeWidth={0.5}
            />
          </g>
        );
      })}

      {/* Paging footer, as in the view: the rows loaded so far (whole pages). */}
      <text x={PADDING + 4} y={footerTop + FOOTER_HEIGHT / 2} dominantBaseline="central" fontSize={6} fill={INK}>
        {footerText}
      </text>
    </svg>
  );
};

export default SqlTableSketch;
