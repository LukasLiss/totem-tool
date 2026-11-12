/**
 * The places a movable ControlPill can snap to, kept apart from the
 * component so ControlPill.tsx exports components only (Fast Refresh).
 */

export type PillSpot = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right';

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
