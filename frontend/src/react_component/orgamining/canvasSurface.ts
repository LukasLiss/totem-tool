/**
 * The material every overlay on the organizational mining canvases is made
 * of. Kept apart from `canvas.tsx` so that file exports components only
 * (Fast Refresh cannot preserve state across a hot reload otherwise).
 */
import type React from "react";

/**
 * Frosted glass rather than a flat fill.
 *
 * The chrome sits over the graph, so an opaque panel hides whatever it covers
 * with no hint that anything is there. The three values are balanced so that
 * a single node behind the panel still registers:
 *
 *  - the blur is small relative to a node (~16px). At 12px it spread a dot
 *    over ~40px and flattened it into the background entirely; 4px keeps it
 *    a recognisable blob while still destroying text and thin arcs, which is
 *    what would otherwise compete with the label on top.
 *  - `saturate` counteracts the whitening. Only ~32% of the backdrop comes
 *    through, which leaves colours washed out and greyish; pushing saturation
 *    makes that remainder read as the colour it actually is.
 *  - the fill stays high enough for 11px text to hold its contrast.
 *
 * Browsers without backdrop-filter just get the flat fill.
 */
export const GLASS_SURFACE: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.68)",
  backdropFilter: "blur(4px) saturate(1.8)",
  WebkitBackdropFilter: "blur(4px) saturate(1.8)",
};
