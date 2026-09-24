/**
 * Visual language for TOTeM models, shared by every view that renders one.
 *
 * The reference is the Analysis section's TOTeM Miner
 * (`react_component/TotemMinerVisualizer.tsx`), which draws the notation of
 * the TOTeM paper: solid object-type boxes, a filled square at the *during*
 * end, a filled arrowhead at the *precedes* end, double bars at both ends of
 * a *parallel* relation, log cardinalities as bare labels near each box and
 * the event cardinalities in an oval at the middle of the line.
 *
 * The miner draws straight into one hand-rolled SVG canvas; the Conformance
 * view and the TOTeM editor draw through React Flow. These tokens and helpers
 * are what the two families have in common, so a model looks the same
 * wherever it is shown.
 */

// ─── Object type box ─────────────────────────────────────────────────────────

export const TOTEM_NODE_HEIGHT = 36;
export const TOTEM_NODE_RADIUS = 6;
export const TOTEM_NODE_PADDING_X = 16;
export const TOTEM_NODE_MIN_WIDTH = 80;
export const TOTEM_NODE_FONT_SIZE = 12;
export const TOTEM_NODE_FONT_WEIGHT = 700;
export const TOTEM_NODE_BORDER_COLOR = 'rgba(0, 0, 0, 0.15)';
export const TOTEM_FONT_FAMILY = 'Inter, ui-sans-serif, system-ui, sans-serif';

// ─── Relation line ───────────────────────────────────────────────────────────

/** Every temporal relation is drawn near-black; an unknown one is muted. */
export const TOTEM_EDGE_COLOR = '#0F172A';
export const TOTEM_EDGE_MUTED_COLOR = '#64748B';
export const TOTEM_EDGE_SELECTED_COLOR = '#2563EB';
export const TOTEM_EDGE_STROKE_WIDTH = 1.5;
/** Parallel lines are drawn slightly thinner so the double bars stay readable. */
export const TOTEM_PARALLEL_STROKE_WIDTH = 1.2;
/** Clearance between the line ends and the two boxes, as in the miner. */
export const TOTEM_SOURCE_CLEARANCE = 1;
export const TOTEM_TARGET_CLEARANCE = 6;

// ─── Relation markers ────────────────────────────────────────────────────────

export const TOTEM_SQUARE_SIZE = 7;
export const TOTEM_ARROW_SIZE = 9;
export const TOTEM_BAR_HALF_LENGTH = 7;
export const TOTEM_BAR_STROKE_WIDTH = 4.5;
/** Distance between the two bars of a parallel marker. */
export const TOTEM_BAR_GAP = 6;

// ─── Annotations ─────────────────────────────────────────────────────────────

export const TOTEM_LABEL_FONT_SIZE = 10;
export const TOTEM_LABEL_OFFSET = 12;
export const TOTEM_SOURCE_LABEL_T = 0.22;
export const TOTEM_TARGET_LABEL_T = 0.78;
export const TOTEM_BUBBLE_FONT_SIZE = 9.5;
export const TOTEM_BUBBLE_RY = 10;
export const TOTEM_BUBBLE_MIN_WIDTH = 40;
export const TOTEM_BUBBLE_PADDING_X = 16;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Rough advance width of a string, good enough to size boxes and ovals. */
export function estimateTotemTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62;
}

/** Width an object type box needs for its name. */
export function totemNodeWidth(label: string): number {
  return Math.max(
    TOTEM_NODE_MIN_WIDTH,
    estimateTotemTextWidth(label, TOTEM_NODE_FONT_SIZE) + TOTEM_NODE_PADDING_X * 2,
  );
}

/** Width of the event cardinality oval for its text. */
export function totemBubbleWidth(label: string): number {
  return Math.max(
    TOTEM_BUBBLE_MIN_WIDTH,
    estimateTotemTextWidth(label, TOTEM_BUBBLE_FONT_SIZE) + TOTEM_BUBBLE_PADDING_X,
  );
}

/** Normalise the cardinality spellings the backend and the editors produce. */
export function formatTotemCardinality(raw: string | null | undefined): string {
  if (!raw) return '';
  const value = raw.trim();
  if (value === '1..1' || value === '1') return '1';
  if (['1..n', '1..*', '1..N', '1,n', '1,*'].includes(value)) return '1..*';
  if (['0..n', '0..*', '0..N', '0,n', '0,*'].includes(value)) return '0..*';
  if (value === '0..1' || value === '0,1') return '0..1';
  return value.replace(/,[nN*]/, '..*').replace(/\.\.[nN]/, '..*');
}
