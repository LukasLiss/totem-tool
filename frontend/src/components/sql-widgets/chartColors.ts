/**
 * Colors for the SQL chart widgets: a color scheme generates as many colors
 * as a chart has categories, and per-category overrides pin single labels to
 * a fixed color. Stored in the widget node's `chart_style.colors` object.
 */

export type ColorScheme = "greyscale" | "categorical" | "shades";

export interface ChartColors {
  /**
   * "single": every category in `single` (bar charts, their default);
   * "category": a color per category from `scheme` (pie charts always);
   * "value": a color between `low` and `high` by the category's value, the
   * smallest value in `low`, the largest in `high` (bar charts).
   * Overrides apply in all modes.
   */
  mode?: "single" | "category" | "value";
  /** The color of "single" mode; the theme's text color (black) when unset. */
  single?: string;
  /** "value" mode: the color of the smallest and of the largest value. */
  low?: string;
  high?: string;
  scheme?: ColorScheme;
  /** Base color for the "shades" scheme. */
  base?: string;
  /**
   * "categorical": pick each category's color from its name instead of its
   * position, so a category keeps its color across logs and data changes.
   */
  stable?: boolean;
  /** Category label → color; wins over the scheme. */
  overrides?: Record<string, string>;
}

export const DEFAULT_COLOR_SCHEME: ColorScheme = "greyscale";
export const DEFAULT_SHADES_BASE = "#2d62ef";
// "single" mode default: the text color, black in light mode (white in dark
// mode, where black bars would disappear on the background).
export const DEFAULT_SINGLE_COLOR = "var(--foreground)";
// What the color picker starts at for DEFAULT_SINGLE_COLOR (it needs a hex value).
export const DEFAULT_SINGLE_PICKER = "#000000";
// "value" mode defaults: a light and a strong shade of the Shades base color.
export const DEFAULT_LOW_COLOR = "#c6d4fb";
export const DEFAULT_HIGH_COLOR = DEFAULT_SHADES_BASE;

/**
 * The color at `t` (0 = `low`, 1 = `high`) of the ramp between two colors,
 * mixed in oklab so the steps look even.
 */
export function valueRampColor(low: string, high: string, t: number): string {
  const share = Math.round(Math.min(1, Math.max(0, t)) * 100);
  return `color-mix(in oklab, ${high} ${share}%, ${low})`;
}

export const COLOR_SCHEME_OPTIONS: { value: ColorScheme; label: string }[] = [
  { value: "greyscale", label: "Greyscale" },
  { value: "categorical", label: "Colorful" },
  { value: "shades", label: "Shades" },
];

// Ten well-separated hues for the "categorical" scheme.
const CATEGORICAL = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];
// Beyond ten categories the same hues come again lighter, then darker, then
// lighter and darker still: 50 distinct colors before any repeats.
const VARIANTS = [
  (color: string) => color,
  (color: string) => `color-mix(in oklab, ${color} 60%, white)`,
  (color: string) => `color-mix(in oklab, ${color} 70%, black)`,
  (color: string) => `color-mix(in oklab, ${color} 35%, white)`,
  (color: string) => `color-mix(in oklab, ${color} 45%, black)`,
];
const COLORFUL = VARIANTS.flatMap((variant) => CATEGORICAL.map(variant));
// Schemes that pick from a fixed list of colors (and so can be name-based).
const PALETTES: Partial<Record<ColorScheme, string[]>> = { categorical: COLORFUL };

export function supportsStableColors(scheme: ColorScheme): boolean {
  return scheme in PALETTES;
}

/** FNV-1a hash of a string, as an unsigned 32-bit number. */
function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Palette position per label, derived from the label itself. The palette is
 * made of groups of `group` hues (base colors first, then their variants); a
 * label gets the hue its name hashes to and, if another label in this chart
 * already has it, the next free base hue, and only then a variant. Labels are
 * placed alphabetically, so the outcome doesn't depend on the data order.
 * With more labels than colors, colors repeat.
 */
function stablePaletteIndices(labels: string[], size: number, group: number): Map<string, number> {
  const taken = new Set<number>();
  const indices = new Map<string, number>();
  for (const label of [...new Set(labels)].sort()) {
    const hue = hashLabel(label) % group;
    let index = hue;
    search: for (let level = 0; level * group < size; level++) {
      for (let step = 0; step < group; step++) {
        const candidate = level * group + ((hue + step) % group);
        if (!taken.has(candidate)) {
          index = candidate;
          break search;
        }
      }
    }
    taken.add(index);
    indices.set(label, index);
  }
  return indices;
}
// Darkest and lightest step of the greyscale / shades ramps, as the share of
// the ink color mixed into the background.
const RAMP_DARKEST = 88;
const RAMP_LIGHTEST = 22;

/**
 * A ramp from strong to faint `color`, mixed into the page background so it
 * follows light and dark mode.
 */
function ramp(color: string, index: number, count: number): string {
  const step = count > 1 ? (RAMP_DARKEST - RAMP_LIGHTEST) / (count - 1) : 0;
  const share = Math.round(RAMP_DARKEST - index * step);
  return `color-mix(in oklab, ${color} ${share}%, var(--background))`;
}

/**
 * Colors for a five-slice preview such as the pie chart sketch: the scheme
 * spread over five slices, with overrides applied where `labels` (the first
 * real categories, if known) have one.
 */
export function previewColors(colors: ChartColors | undefined, labels: string[] = []): string[] {
  const five = Array.from({ length: 5 }, (_, i) => labels[i] ?? `\u0000preview-${i}`);
  return resolveChartColors(five, colors);
}

/**
 * Whether the colors depend on the category names (a per-category override,
 * or stable name-based colors), so a preview needs the real categories to
 * match the chart; otherwise placeholder labels give the same colors.
 */
export function colorsDependOnLabels(colors: ChartColors | undefined): boolean {
  return Boolean(colors?.stable) || Object.keys(colors?.overrides ?? {}).length > 0;
}

// The grouped "Other" slice: a faint neutral grey, lighter than any greyscale step.
export const OTHER_COLOR = "color-mix(in oklab, var(--foreground) 10%, var(--background))";
// "value" mode: a point without a numeric value.
export const NO_VALUE_COLOR = "color-mix(in oklab, var(--foreground) 25%, var(--background))";

/**
 * "value" mode: the color of `value` on the ramp from the smallest value
 * (`min`, the low color) to the largest (`max`, the high color). When all
 * values are equal everything gets the high color; no value gets grey.
 */
export function valueFill(colors: ChartColors | undefined, value: number | null, min: number, max: number): string {
  if (value == null || !Number.isFinite(value)) return NO_VALUE_COLOR;
  const t = max > min ? (value - min) / (max - min) : 1;
  return valueRampColor(colors?.low ?? DEFAULT_LOW_COLOR, colors?.high ?? DEFAULT_HIGH_COLOR, t);
}

/**
 * One color per slice, like resolveChartColors, but an "Other" slice gets the
 * neutral OTHER_COLOR (or its override) and doesn't use up a scheme color.
 */
export function categoryFills(
  slices: { label: string; value?: number; other?: boolean }[],
  colors: ChartColors | undefined
): string[] {
  const own = slices.filter((slice) => !slice.other);
  const schemeFills = resolveChartColors(
    own.map((slice) => slice.label),
    colors,
    own.map((slice) => slice.value ?? 0)
  );
  let next = 0;
  return slices.map((slice) =>
    slice.other ? colors?.overrides?.[slice.label] ?? OTHER_COLOR : schemeFills[next++]
  );
}

/**
 * One color per label, in label order. `values` (one per label) are used by
 * "value" mode; without them the labels count as falling from the largest
 * value to the smallest, like the bars of a chart sketch.
 */
export function resolveChartColors(
  labels: string[],
  colors: ChartColors | undefined,
  values?: number[]
): string[] {
  if (colors?.mode === "value") {
    const vs = values ?? labels.map((_, i) => labels.length - 1 - i);
    const finite = vs.filter(Number.isFinite);
    const min = finite.length ? Math.min(...finite) : 0;
    const max = finite.length ? Math.max(...finite) : 0;
    return labels.map((label, i) => colors.overrides?.[label] ?? valueFill(colors, vs[i], min, max));
  }
  if (colors?.mode === "single") {
    const single = colors.single ?? DEFAULT_SINGLE_COLOR;
    return labels.map((label) => colors.overrides?.[label] ?? single);
  }
  const scheme = colors?.scheme ?? DEFAULT_COLOR_SCHEME;
  const count = labels.length;
  const palette = PALETTES[scheme];
  // Categories with a fixed color don't take up a palette color.
  const stableIndex =
    palette && colors?.stable
      ? stablePaletteIndices(
          labels.filter((label) => !colors.overrides?.[label]),
          palette.length,
          CATEGORICAL.length
        )
      : null;
  return labels.map((label, index) => {
    const override = colors?.overrides?.[label];
    if (override) return override;
    if (palette) return palette[(stableIndex?.get(label) ?? index) % palette.length];
    if (scheme === "shades") return ramp(colors?.base ?? DEFAULT_SHADES_BASE, index, count);
    return ramp("var(--foreground)", index, count);
  });
}
