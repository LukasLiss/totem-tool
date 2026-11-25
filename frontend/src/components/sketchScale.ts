import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Max width of the graph drafts' sketches in their edit tiles (process
 * models, TOTeM, organizational mining): a little more than the charts'
 * default, as graphs of small nodes look smaller than a chart of the same
 * width — and the same for all of them, so they look alike side by side.
 */
export const GRAPH_SKETCH_MAX_WIDTH = "max-w-xl";

/**
 * How many viewBox units one screen pixel spans in a sketch's SVG (scaled to
 * fit its box, as with the default `preserveAspectRatio`), so a detail can be
 * drawn at a fixed on-screen size whatever size the sketch has. Before the
 * SVG is measured (or without ResizeObserver) it is 1.
 */
export function useSvgUnitsPerPixel(ref: RefObject<SVGSVGElement | null>, viewBoxWidth: number, viewBoxHeight: number): number {
  const [unitsPerPixel, setUnitsPerPixel] = useState(1);
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const { width, height } = svg.getBoundingClientRect();
      if (width > 0 && height > 0) setUnitsPerPixel(1 / Math.min(width / viewBoxWidth, height / viewBoxHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [ref, viewBoxWidth, viewBoxHeight]);
  return unitsPerPixel;
}
