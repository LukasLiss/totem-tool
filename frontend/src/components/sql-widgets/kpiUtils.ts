/**
 * Reading and formatting the KPI's value, shared by the widget and the
 * draft in its settings popup so both show the same number.
 */

import { useLayoutEffect, useState } from "react";
import { firstNumericColumn, toNumber } from "./sqlWidgetUtils";

/**
 * The KPI number comes in a few fixed sizes, picked by the card's size, so
 * KPIs of similar size look alike and a small card gets a smaller number.
 * `minWidth` / `minHeight` are of the whole card (header included); the
 * largest size the card reaches is used. Prefix and suffix grow along.
 */
export const KPI_SIZES = [
  { number: 28, affix: 14, minWidth: 0, minHeight: 0 },
  { number: 40, affix: 16, minWidth: 260, minHeight: 160 },
  { number: 56, affix: 18, minWidth: 400, minHeight: 220 },
  { number: 72, affix: 22, minWidth: 560, minHeight: 300 },
  { number: 96, affix: 28, minWidth: 760, minHeight: 400 },
  { number: 128, affix: 36, minWidth: 1000, minHeight: 520 },
] as const;
export type KpiSize = (typeof KPI_SIZES)[number];

// Horizontal padding of the card's content (p-4), the room the number line has to fit into.
const CONTENT_PADDING_X = 32;
// Rough average glyph width as a share of the font size, for fitting without measuring.
const GLYPH_WIDTH = 0.6;
const AFFIX_GAP = 4;

/** The largest size the card reaches that still fits the number line across. */
export function kpiSizeFor(cardWidth: number, cardHeight: number, number: string, affixes: string): KpiSize {
  for (let i = KPI_SIZES.length - 1; i > 0; i--) {
    const size = KPI_SIZES[i];
    if (cardWidth < size.minWidth || cardHeight < size.minHeight) continue;
    const lineWidth =
      number.length * GLYPH_WIDTH * size.number +
      affixes.length * GLYPH_WIDTH * size.affix +
      (affixes ? 2 * AFFIX_GAP : 0);
    if (lineWidth <= cardWidth - CONTENT_PADDING_X) return size;
  }
  return KPI_SIZES[0];
}

/**
 * The KPI size for the card `element` (observed while it resizes). It only
 * changes state when the size step changes, so resizing doesn't re-render
 * the widget on every pixel. Medium until the card is measured.
 */
export function useKpiSize(element: HTMLElement | null, number: string, affixes: string): KpiSize {
  const [size, setSize] = useState<KpiSize>(KPI_SIZES[2]);
  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) setSize(kpiSizeFor(width, height, number, affixes));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, number, affixes]);
  return size;
}

export interface KpiValue {
  /** The column the value was read from. */
  column: string;
  raw: unknown;
}

/** The first row's value: from `valueColumn`, else the first numeric column, else the first column. */
export function pickKpiValue(
  rows: Record<string, unknown>[],
  columns: string[],
  valueColumn: string
): KpiValue | null {
  if (rows.length === 0) return null;
  const column = valueColumn || firstNumericColumn(rows, columns) || columns[0];
  if (!column) return null;
  return { column, raw: rows[0][column] };
}

// Stands in for the query result in the draft; formatted like the real number.
const SAMPLE_VALUE = 12345.6789012345;

/** The draft's sample number, formatted with `decimals` like the real one. */
export function kpiSampleNumber(decimals: number): string {
  return formatKpiValue(SAMPLE_VALUE, decimals);
}

/** The value as shown: numbers with exactly `decimals` decimals, NULL and text as they are. */
export function formatKpiValue(raw: unknown, decimals: number): string {
  const numeric = toNumber(raw);
  if (numeric != null) {
    return numeric.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return raw == null ? "NULL" : String(raw);
}
