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
 * with no hint that anything is there. Plain transparency would show it, but
 * at the level needed to actually see through, arcs and labels compete with
 * the small text on top. Blurring the backdrop keeps the colour and position
 * of what is behind while removing the detail that would fight the text.
 * Browsers without backdrop-filter just get the flat fill.
 */
export const GLASS_SURFACE: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.72)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
};
