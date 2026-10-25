/**
 * Block-level formatting for the dashboard Text Box widget (#373).
 *
 * Every option applies to the whole text box — there is deliberately no
 * per-character rich text, so nothing here ever produces HTML and the
 * widget stays safe by construction (React escapes the text node).
 *
 * The option keys mirror `TextBoxComponent`'s choices in
 * `backend/api/models.py`; the backend validates the same values again in
 * `save_layout`. `resolveTextBoxFormat` is the single place that turns a
 * possibly-partial GridStack node into a complete, known-good set, so the
 * edit toolbar, the view-mode render and the save payload cannot drift.
 */
import type { CSSProperties } from 'react';

export type TextFontFamily = 'sans' | 'serif' | 'mono';
export type TextFontWeight = 'normal' | 'bold';
export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type TextVerticalAlign = 'top' | 'middle' | 'bottom';

export interface TextBoxFormat {
  font_size: number;
  font_family: TextFontFamily;
  font_weight: TextFontWeight;
  italic: boolean;
  underline: boolean;
  text_align: TextAlign;
  vertical_align: TextVerticalAlign;
  text_color: string;
  background_color: string;
  line_height: number;
}

/**
 * Defaults that reproduce the look the Text Box had before formatting
 * existed, so dashboards saved earlier render identically. These match the
 * model defaults exactly — change both or neither.
 */
export const TEXT_BOX_FORMAT_DEFAULTS: TextBoxFormat = {
  font_size: 14,
  font_family: 'sans',
  font_weight: 'normal',
  italic: false,
  underline: false,
  text_align: 'left',
  vertical_align: 'top',
  text_color: '#1e293b',
  background_color: '#ffffff',
  line_height: 1.5,
};

/** Bounds mirrored from `_validated_number` in `views/dashboards.py`. */
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 200;
export const LINE_HEIGHT_MIN = 0.5;
export const LINE_HEIGHT_MAX = 5;

export const FONT_FAMILY_OPTIONS: Array<{ value: TextFontFamily; label: string }> = [
  { value: 'sans', label: 'Sans serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Monospace' },
];

export const TEXT_ALIGN_OPTIONS: Array<{ value: TextAlign; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
  { value: 'justify', label: 'Justify' },
];

export const VERTICAL_ALIGN_OPTIONS: Array<{ value: TextVerticalAlign; label: string }> = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
];

/**
 * System font stacks only — resolved through the design-system tokens in
 * `styles/custom.css`. No webfonts: the packaged desktop app runs offline
 * from a PyInstaller bundle, so a remote font would fail there and only
 * there.
 */
export const FONT_FAMILY_STACKS: Record<TextFontFamily, string> = {
  sans: 'var(--font-sans)',
  serif: 'var(--font-serif)',
  mono: 'var(--font-mono)',
};

/** Design-system text colours, then the first half of the actor palette. */
export const TEXT_COLOR_SWATCHES = [
  '#0f172a',
  '#1e293b',
  '#64748b',
  '#94a3b8',
  '#ffffff',
  '#2563eb',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#f43f5e',
] as const;

/** Card/page greys, the dark sidebar slate, then tints for callout boxes. */
export const BACKGROUND_COLOR_SWATCHES = [
  '#ffffff',
  '#f8fafc',
  '#f1f5f9',
  '#e2e8f0',
  '#1e293b',
  '#eff6ff',
  '#dcfce7',
  '#fef3c7',
  '#fee2e2',
  '#ede9fe',
] as const;

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** True for a `#rgb` / `#rrggbb` literal — the only colours we store. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value.trim());
}

function pickChoice<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

function pickNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function pickColor(raw: unknown, fallback: string): string {
  return isHexColor(raw) ? raw.trim().toLowerCase() : fallback;
}

/**
 * Fill in and sanitise a partial node into a complete format. Anything
 * unrecognised falls back to the default rather than being dropped, so an
 * old dashboard, a hand-edited payload and a fresh drag-in all end up with
 * a renderable set of values.
 */
export function resolveTextBoxFormat(raw: Partial<TextBoxFormat> | undefined | null): TextBoxFormat {
  const node = raw ?? {};
  const d = TEXT_BOX_FORMAT_DEFAULTS;
  return {
    font_size: Math.round(pickNumber(node.font_size, d.font_size, FONT_SIZE_MIN, FONT_SIZE_MAX)),
    font_family: pickChoice(node.font_family, ['sans', 'serif', 'mono'], d.font_family),
    font_weight: pickChoice(node.font_weight, ['normal', 'bold'], d.font_weight),
    italic: Boolean(node.italic),
    underline: Boolean(node.underline),
    text_align: pickChoice(
      node.text_align,
      ['left', 'center', 'right', 'justify'],
      d.text_align,
    ),
    vertical_align: pickChoice(
      node.vertical_align,
      ['top', 'middle', 'bottom'],
      d.vertical_align,
    ),
    text_color: pickColor(node.text_color, d.text_color),
    background_color: pickColor(node.background_color, d.background_color),
    line_height: pickNumber(node.line_height, d.line_height, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX),
  };
}

const VERTICAL_ALIGN_TO_FLEX: Record<TextVerticalAlign, CSSProperties['justifyContent']> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

/**
 * The scroll container: owns the background and where the text sits
 * vertically. Vertical alignment needs a flex parent, which is why it is
 * separate from the text style below.
 */
export function textBoxContainerStyle(format: TextBoxFormat): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: VERTICAL_ALIGN_TO_FLEX[format.vertical_align],
    background: format.background_color,
    overflow: 'auto',
  };
}

/** The text itself. Used for both the view-mode paragraph and the editor. */
export function textBoxTextStyle(format: TextBoxFormat): CSSProperties {
  return {
    fontSize: format.font_size,
    fontFamily: FONT_FAMILY_STACKS[format.font_family],
    fontWeight: format.font_weight,
    fontStyle: format.italic ? 'italic' : 'normal',
    textDecoration: format.underline ? 'underline' : 'none',
    textAlign: format.text_align,
    color: format.text_color,
    lineHeight: format.line_height,
  };
}

/**
 * The formatting keys as a flat object, for the three hand-maintained
 * plumbing lists in `gridstackprovider.tsx` (save and load) and the
 * side-panel drag-in seed. Keeping them all on this one function is what
 * stops a new option from being persisted but never loaded back.
 */
export function textBoxFormatProps(raw: Partial<TextBoxFormat> | undefined | null): TextBoxFormat {
  return resolveTextBoxFormat(raw);
}
