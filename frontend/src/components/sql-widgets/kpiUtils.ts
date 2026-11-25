/**
 * Reading and formatting the KPI's value, shared by the widget and the
 * draft in its settings popup so both show the same number.
 */

import { firstNumericColumn, toNumber } from "./sqlWidgetUtils";

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
