/**
 * Colors for the SQL chart widgets: a color scheme generates as many colors
 * as a chart has categories, and per-category overrides pin single labels to
 * a fixed color. Stored in the widget node's `chart_style.colors` object.
 */

export type ColorScheme = "greyscale" | "categorical" | "shades";

export interface ChartColors {
  /**
   * "single": every category in `single` (bar charts, their default);
   * "category": a color per category from `scheme` (pie charts always).
   * Overrides apply in both modes.
   */
  mode?: "single" | "category";
  /** The color of "single" mode; the theme's text color (black) when unset. */
  single?: string;
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

// The grouped "Other" slice: a faint neutral grey, lighter than any greyscale step.
export const OTHER_COLOR = "color-mix(in oklab, var(--foreground) 10%, var(--background))";

/**
 * One color per slice, like resolveChartColors, but an "Other" slice gets the
 * neutral OTHER_COLOR (or its override) and doesn't use up a scheme color.
 */
export function categoryFills(
  slices: { label: string; other?: boolean }[],
  colors: ChartColors | undefined
): string[] {
  const schemeFills = resolveChartColors(
    slices.filter((slice) => !slice.other).map((slice) => slice.label),
    colors
  );
  let next = 0;
  return slices.map((slice) =>
    slice.other ? colors?.overrides?.[slice.label] ?? OTHER_COLOR : schemeFills[next++]
  );
}

/** One color per label, in label order. */
export function resolveChartColors(labels: string[], colors: ChartColors | undefined): string[] {
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
