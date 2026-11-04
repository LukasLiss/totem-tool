/**
 * Stored layout preferences of an OC-DFG view.
 *
 * A view stores `{ version: 1, options: {...} }` with only the options that
 * differ from its defaults — on the dashboard widget for dashboards, on the
 * project for the analysis views. Reading is strict: when anything about a
 * stored entry is off (not an object, another version, an unknown option, a
 * value of the wrong type or out of range), the whole entry is ignored and
 * the view uses its defaults.
 */
import { ASPECT_BY_KEY, BOOLEAN_OPTIONS, DEFAULT_OPTIONS, NUMERIC_BOUNDS } from './options';
import type { LayoutOptions } from './types';

export const LAYOUT_PREFERENCES_VERSION = 1;

export interface StoredLayout {
  version: typeof LAYOUT_PREFERENCES_VERSION;
  options: Partial<LayoutOptions>;
}

/** Options about which data is shown, not how: the views' legends own them. */
const DATA_OPTIONS = new Set<keyof LayoutOptions>(['hiddenTypes', 'variantCoverage', 'arcThreshold']);

const STORABLE = (Object.keys(DEFAULT_OPTIONS) as Array<keyof LayoutOptions>).filter((k) => !DATA_OPTIONS.has(k));

const MAX_LANES = 500;
const MAX_NAME = 500;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function validValue(key: keyof LayoutOptions, value: unknown): boolean {
  const aspect = ASPECT_BY_KEY[key];
  if (aspect) return typeof value === 'string' && aspect.choices.some((c) => c.value === value);
  if (key in NUMERIC_BOUNDS) {
    const b = NUMERIC_BOUNDS[key as keyof typeof NUMERIC_BOUNDS];
    return typeof value === 'number' && Number.isFinite(value) && value >= b.min && value <= b.max;
  }
  if ((BOOLEAN_OPTIONS as ReadonlyArray<string>).includes(key)) return typeof value === 'boolean';
  if (key === 'arcLabels') return value === 'none' || value === 'frequency';
  if (key === 'manualLaneOrder') {
    return (
      Array.isArray(value) &&
      value.length <= MAX_LANES &&
      value.every((t) => typeof t === 'string' && t.length <= MAX_NAME)
    );
  }
  return false;
}

/** The options of a stored entry, or null when the entry is unusable. */
export function parseStoredLayout(raw: unknown): Partial<LayoutOptions> | null {
  if (!isPlainObject(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 2 || !keys.includes('version') || !keys.includes('options')) return null;
  if (raw.version !== LAYOUT_PREFERENCES_VERSION || !isPlainObject(raw.options)) return null;
  const options: Partial<LayoutOptions> = {};
  for (const [key, value] of Object.entries(raw.options)) {
    if (!(STORABLE as string[]).includes(key)) return null;
    if (!validValue(key as keyof LayoutOptions, value)) return null;
    (options as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value;
  }
  return options;
}

/** The view's options from a stored entry, falling back to `defaults`. */
export function fromStoredLayout(raw: unknown, defaults: LayoutOptions): LayoutOptions {
  const parsed = parseStoredLayout(raw);
  if (!parsed) return defaults;
  const merged = { ...defaults, ...parsed };
  if (merged.minWidth > merged.maxWidth) return defaults;
  return merged;
}

/** What to store for `options`: the differences to `defaults`, or null for none. */
export function toStoredLayout(options: LayoutOptions, defaults: LayoutOptions): StoredLayout | null {
  const diff: Partial<LayoutOptions> = {};
  for (const key of STORABLE) {
    if (JSON.stringify(options[key]) !== JSON.stringify(defaults[key])) {
      (diff as Record<string, unknown>)[key] = options[key];
    }
  }
  return Object.keys(diff).length > 0 ? { version: LAYOUT_PREFERENCES_VERSION, options: diff } : null;
}
