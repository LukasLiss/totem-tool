/**
 * The DFG view's automatic fit: where the graph goes so the canvas controls
 * (title, legend, chips, control pill) don't cover it. Only the view; the
 * layout itself and a view the user zoomed or panned stay as they are
 * (LabCanvas follows the fit only until then; the fit button uses it).
 */
import type { PillRegion } from '@/components/canvas/pillSpots';

/** Height of the title row and of the collapsed chips (legend, animation). */
export const CHIP_HEIGHT = 30;
/** Space between the title and the legend below it. */
export const TITLE_LEGEND_GAP = 8;
/** Space the fit keeps between the graph and a control. */
export const FIT_GAP = 24;

export type FitPadding = { top: number; right: number; bottom: number; left: number };

/**
 * A control's box on the canvas (px from the view's top left).
 * `header`: part of the header row (title, collapsed chips): the graph always
 * starts below it, never beside it. `optional`: a large panel the graph only
 * makes room for while that leaves it at least half its size; otherwise
 * (narrow boxes) the panel lies over it.
 */
export interface FitRect {
  x: number;
  y: number;
  w: number;
  h: number;
  header?: boolean;
  optional?: boolean;
}

/** Where the fitted graph goes: its scale and its top-left corner on screen (px). */
export interface FitPlacement {
  scale: number;
  x: number;
  y: number;
}

/**
 * Where (px from the start) a fitted graph of length `graph` goes along a box
 * of length `box` with `start` / `end` kept free: centred in the whole box,
 * and moved only as far as needed to keep clear of the free room. So a graph
 * with room to spare stays where it is when a control (e.g. the pill) changes
 * sides. Too long for the room: centred in it.
 */
export function placeSpan(box: number, graph: number, start: number, end: number): number {
  const latest = box - end - graph;
  if (latest < start) return start + (box - start - end - graph) / 2;
  return Math.min(Math.max((box - graph) / 2, start), latest);
}

/** The pill's box, for the fit. */
export const pillRect = (region: PillRegion): FitRect => ({ x: region.left, y: region.top, w: region.width, h: region.height });

/**
 * The best place for a graph of `graph` size (layout units) in a box of `box`
 * px: clear of every control in `rects` (by `gap`) and of the `base` margins.
 *
 * The header row (title, collapsed chips) is cleared by starting below it;
 * any other control by keeping the graph above, below, left or right of it.
 * Of all these combinations the one that shows the graph largest wins,
 * and of equally large ones the one closest to the centre. So the graph
 * slides below an open legend rather than squeezing beside it when that
 * leaves it larger, and stays centred while it has room to spare.
 */
export function bestFit(
  box: { w: number; h: number },
  graph: { w: number; h: number },
  base: FitPadding,
  rects: FitRect[],
  maxScale: number,
  gap = FIT_GAP,
): FitPlacement {
  type Candidate = FitPlacement & { shift: number };
  const solve = (controls: FitRect[]): Candidate | null => {
    const ways = controls.map((r): Partial<FitPadding>[] =>
      r.header
        ? [{ top: r.y + r.h + gap }]
        : [{ bottom: box.h - r.y + gap }, { top: r.y + r.h + gap }, { right: box.w - r.x + gap }, { left: r.x + r.w + gap }],
    );
    let best: Candidate | null = null;
    const visit = (i: number, pad: FitPadding) => {
      if (i < ways.length) {
        for (const way of ways[i]) {
          visit(i + 1, {
            top: Math.max(pad.top, way.top ?? 0),
            right: Math.max(pad.right, way.right ?? 0),
            bottom: Math.max(pad.bottom, way.bottom ?? 0),
            left: Math.max(pad.left, way.left ?? 0),
          });
        }
        return;
      }
      const availW = box.w - pad.left - pad.right;
      const availH = box.h - pad.top - pad.bottom;
      if (availW <= 0 || availH <= 0) return;
      const scale = Math.min(availW / graph.w, availH / graph.h, maxScale);
      const gw = graph.w * scale;
      const gh = graph.h * scale;
      const x = placeSpan(box.w, gw, pad.left, pad.right);
      const y = placeSpan(box.h, gh, pad.top, pad.bottom);
      const shift = Math.abs(x - (box.w - gw) / 2) + Math.abs(y - (box.h - gh) / 2);
      const larger = !best || scale > best.scale * (1 + 1e-6);
      const asLarge = best != null && scale >= best.scale * (1 - 1e-6);
      if (larger || (asLarge && shift < best!.shift)) best = { scale, x, y, shift };
    };
    visit(0, base);
    return best;
  };

  const all = solve(rects);
  let chosen = all;
  if (rects.some((r) => r.optional)) {
    const required = solve(rects.filter((r) => !r.optional));
    if (required && (!all || all.scale < 0.5 * required.scale)) chosen = required;
  }
  chosen ??= solve([]);
  if (chosen) return { scale: chosen.scale, x: chosen.x, y: chosen.y };
  // Not even the base margins leave room: the whole box.
  const scale = Math.min(box.w / graph.w, box.h / graph.h, maxScale);
  return { scale, x: (box.w - graph.w * scale) / 2, y: (box.h - graph.h * scale) / 2 };
}
