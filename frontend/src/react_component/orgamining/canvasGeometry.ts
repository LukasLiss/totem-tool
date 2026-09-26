/**
 * Geometry for the organizational mining canvases.
 *
 * Both explorers lay their graphs out in a fixed coordinate space and then fit
 * that space into whatever box the host gives them. These helpers do the
 * fitting; they live apart from `canvas.tsx` so that file exports components
 * only (Fast Refresh cannot preserve state across a hot reload otherwise).
 */

export type Size = { width: number; height: number };
export type ViewBox = { x: number; y: number; w: number; h: number };

/** Below this rendered width a FloatingPanel starts collapsed to its chip. */
export const NARROW_CANVAS_WIDTH = 520;

/**
 * Fit a bounding box into a viewBox with the given aspect ratio.
 *
 * The shorter side is grown — never the longer one shrunk — so the content
 * keeps its proportions and the extra space becomes margin. This is what
 * keeps MDS distances and force-layout geometry undistorted at any tile shape.
 */
export function fitBoxToAspect(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  aspect: number,
  pad: number,
  minSize: number,
): ViewBox {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  let w = Math.max(box.maxX - box.minX + pad * 2, minSize);
  let h = Math.max(box.maxY - box.minY + pad * 2, minSize);
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  if (w / h < safeAspect) w = h * safeAspect;
  else h = w / safeAspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Bounding box of a point cloud; null for an empty cloud. */
export function pointsBounds(points: { x: number; y: number }[]) {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
