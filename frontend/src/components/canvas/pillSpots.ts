/**
 * The places a movable ControlPill can snap to, kept apart from the
 * component so ControlPill.tsx exports components only (Fast Refresh).
 */

export type PillSpot = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right';

/** Distance of a movable pill from the canvas edges. */
export const PILL_MARGIN = 16;

/** Where a movable pill sits in its canvas (px, relative to the canvas' top left). */
export interface PillRegion {
  spot: PillSpot;
  top: number;
  left: number;
  width: number;
  height: number;
  /** The canvas' size, so panels can tell how much room the pill leaves them. */
  canvasWidth: number;
  canvasHeight: number;
}

/** The pill's box at `spot` from its size and the canvas' size (transforms such as a glide left out). */
export function pillRegion(
  spot: PillSpot,
  size: { width: number; height: number },
  canvas: { width: number; height: number },
  insetTop = 0,
): PillRegion {
  const top =
    spot === 'top-left' || spot === 'top-right'
      ? PILL_MARGIN + insetTop
      : spot === 'bottom-left' || spot === 'bottom-right'
        ? canvas.height - PILL_MARGIN - size.height
        : (canvas.height - size.height) / 2;
  const left = spot === 'top-left' || spot === 'bottom-left' || spot === 'left' ? PILL_MARGIN : canvas.width - PILL_MARGIN - size.width;
  return { spot, top, left, width: size.width, height: size.height, canvasWidth: canvas.width, canvasHeight: canvas.height };
}

/**
 * Room (px) a panel anchored at the top of the canvas must keep free at the
 * bottom so it ends `gap` above the pill — or `fallback` when the pill is not
 * below it. `onLeft` says which side the panel is on; a pill on that side
 * (corner or edge middle) is below it, and so is one reaching under the
 * panel's `reach` (its farthest edge from that side, in px).
 */
export function roomBelowForPill(
  region: PillRegion | null,
  onLeft: boolean,
  { gap = 8, fallback = PILL_MARGIN, reach = 0 }: { gap?: number; fallback?: number; reach?: number } = {},
): number {
  if (!region) return fallback;
  const sameSide = onLeft
    ? region.spot === 'bottom-left' || region.spot === 'left'
    : region.spot === 'bottom-right' || region.spot === 'right';
  const reachesUnder = reach > 0 && (onLeft ? region.left < reach : region.left + region.width > region.canvasWidth - reach);
  const below = sameSide || ((region.spot === 'bottom-left' || region.spot === 'bottom-right') && reachesUnder);
  if (!below) return fallback;
  return Math.max(fallback, region.canvasHeight - region.top + gap);
}

/** Where a panel opened from the pill goes (px for an absolutely positioned box). */
export interface PanelAtPill {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  maxHeight: number | string;
}

/** Height of a lying pill (36 px buttons, 6 px padding, border), for when it is not measured yet. */
const PILL_HEIGHT = 50;

/**
 * The place of a panel that opens from the pill (its popovers): `gap` away
 * from the pill, on the canvas side of it, flush with its outer edge —
 * above a pill in a bottom corner, below one in a top corner, beside one
 * standing at the left or right edge (bottom edges level). Without a
 * measured pill: above the bottom-right corner, where the fixed pill sits.
 */
export function panelAtPill(region: PillRegion | null, gap = 8): PanelAtPill {
  if (!region) {
    const bottom = PILL_MARGIN + PILL_HEIGHT + gap;
    return { bottom, right: PILL_MARGIN, maxHeight: `calc(100% - ${bottom + PILL_MARGIN}px)` };
  }
  const { spot, top, left, width, height, canvasWidth, canvasHeight } = region;
  const fromRight = canvasWidth - (left + width);
  const side = spot === 'top-left' || spot === 'bottom-left' ? { left } : { right: fromRight };
  if (spot === 'bottom-left' || spot === 'bottom-right') {
    return { ...side, bottom: canvasHeight - top + gap, maxHeight: Math.max(0, top - gap - PILL_MARGIN) };
  }
  if (spot === 'top-left' || spot === 'top-right') {
    const below = top + height + gap;
    return { ...side, top: below, maxHeight: Math.max(0, canvasHeight - below - PILL_MARGIN) };
  }
  const bottom = canvasHeight - (top + height);
  const beside = spot === 'left' ? { left: left + width + gap } : { right: canvasWidth - left + gap };
  return { ...beside, bottom, maxHeight: Math.max(0, canvasHeight - bottom - PILL_MARGIN) };
}

/** The middle of the left or right edge holds the pill vertically; the corners horizontally. */
export const isVerticalSpot = (spot: PillSpot) => spot === 'left' || spot === 'right';

/**
 * In the right corners the grip sits at the pill's right end, next to the
 * edge, so the bar extends inwards from it; elsewhere it leads (left or top).
 */
export const gripAtEnd = (spot: PillSpot) => spot === 'top-right' || spot === 'bottom-right';

/**
 * The spot whose anchor (a corner, or the middle of the left/right edge) is
 * closest to `center`, a point in a box of `size` (both in the canvas' pixels).
 */
export function nearestSpot(
  center: { x: number; y: number },
  size: { width: number; height: number },
  spots: readonly PillSpot[],
): PillSpot {
  const anchor: Record<PillSpot, { x: number; y: number }> = {
    'top-left': { x: 0, y: 0 },
    'top-right': { x: size.width, y: 0 },
    'bottom-left': { x: 0, y: size.height },
    'bottom-right': { x: size.width, y: size.height },
    left: { x: 0, y: size.height / 2 },
    right: { x: size.width, y: size.height / 2 },
  };
  let best = spots[0];
  let bestDistance = Infinity;
  for (const spot of spots) {
    const a = anchor[spot];
    const d = Math.hypot(center.x - a.x, center.y - a.y);
    if (d < bestDistance) {
      best = spot;
      bestDistance = d;
    }
  }
  return best;
}
