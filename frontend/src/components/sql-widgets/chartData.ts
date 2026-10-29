/**
 * Shaping query rows into chart categories, shared by the SQL chart widgets:
 * one category (label + value) per row, optionally limited to the largest N.
 */

export const OTHER_LABEL = "Other";

export interface CategorySlice {
  label: string;
  value: number;
  /** The "Other" slice that sums up the categories beyond the limit. */
  other?: boolean;
}

/** One category per row, from the given label and value columns. */
export function rowsToCategories(
  rows: Record<string, unknown>[],
  labelColumn: string,
  valueColumn: string
): CategorySlice[] {
  return rows.map((row) => ({
    label: String(row[labelColumn]),
    value: parseFloat(String(row[valueColumn])) || 0,
  }));
}

/**
 * Keeps the `max` largest categories, in their original order. The rest is
 * summed up into one "Other" slice at the end when `groupRest` is set (pie
 * charts), or left out (bar charts). Unchanged when `max` is unset or there
 * are not more categories than that.
 */
export function limitCategories(
  slices: CategorySlice[],
  max?: number | null,
  { groupRest = true }: { groupRest?: boolean } = {}
): CategorySlice[] {
  if (!max || max < 1 || slices.length <= max) return slices;
  const largest = new Set(
    slices
      .map((_, i) => i)
      .sort((a, b) => slices[b].value - slices[a].value)
      .slice(0, max)
  );
  const kept = slices.filter((_, i) => largest.has(i));
  if (!groupRest) return kept;
  const rest = slices.reduce((sum, slice, i) => (largest.has(i) ? sum : sum + slice.value), 0);
  return [...kept, { label: OTHER_LABEL, value: rest, other: true }];
}
