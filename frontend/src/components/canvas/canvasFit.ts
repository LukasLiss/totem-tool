/**
 * The automatic fit of the graph canvases (the DFG, the handover): where the
 * graph goes so the canvas controls (title, legend, chips, control pill)
 * don't cover it. Only the view; the layout itself and a view the user zoomed
 * or panned stay as they are (the canvases follow the fit only until then;
 * the fit button returns to it).
 */
import type { PillRegion } from './pillSpots';

/** Height of the title row and of the collapsed chips (legend, animation). */
export const CHIP_HEIGHT = 30;
/** Space between the title and the legend below it. */
export const TITLE_LEGEND_GAP = 8;
/** Space the fit keeps between the graph and a control. */
export const FIT_GAP = 24;

export type FitPadding = { top: number; right: number; bottom: number; left: number };

/**
 * A control's box on the canvas (px from the view's top left).
 * `header`: part of the header row (title, top-right chips): the graph always
 * starts below it, never beside it.
 * `corner`: a small chip in a top corner under the title (the collapsed
 * legend): the graph starts below it, or beside it from the top of the free
 * room only where the chip does not push it aside (where it lies anyway) —
 * so a narrow graph gets the full height, and a wide one is never pushed
 * aside for it.
 * `footer`: a bar along the bottom (the open control pill lying in a bottom
 * corner): the graph stays above it, or reaches down beside it where the bar
 * pushes it aside by at most a tenth of the width (BAR_PUSH) — never
 * squeezed into the strip beside it.
 * `optional`: a large panel the graph only makes room for while that leaves
 * it at least half its size; otherwise (narrow boxes) the panel lies over it.
 */
export interface FitRect {
  x: number;
  y: number;
  w: number;
  h: number;
  header?: boolean;
  corner?: boolean;
  footer?: boolean;
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

/**
 * How far (share of the box width) a bottom bar (the open pill in a corner)
 * may push the graph aside when the graph reaches down beside it.
 */
const BAR_PUSH = 0.1;

/**
 * The pill's box, for the fit. Open and lying in a bottom corner, it is a bar
 * along the bottom (`footer`: the graph stays above it); collapsed to its grip
 * the graph may use the room beside it, and standing at a side it goes beside it.
 */
export const pillRect = (region: PillRegion): FitRect => {
  const rect = { x: region.left, y: region.top, w: region.width, h: region.height };
  const lyingAtBottom = region.spot === 'bottom-left' || region.spot === 'bottom-right';
  return lyingAtBottom && region.width > 2 * region.height ? { ...rect, footer: true } : rect;
};

/**
 * The best place for a graph of `graph` size (layout units) in a box of `box`
 * px: clear of every control in `rects` (by `gap`) and of the `base` margins.
 *
 * The header row (title, top-right chips) is cleared by starting below it; a
 * corner chip (the collapsed legend) by starting below it, a bottom bar (the
 * open pill in a corner) by ending above it — or either by lying beside it
 * where the graph is not moved for that (see FitRect); any other control by
 * keeping the graph above, below, left or right of it. Of all these combinations the one that shows the
 * graph largest wins, and of equally large ones the one closest to the
 * centre. So the graph uses the room beside a collapsed pill, moves aside for
 * an open legend where that leaves it larger, and stays centred while it has
 * room to spare.
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
  /**
   * A way around a control; `soft`: only valid where it moves the graph aside
   * by at most this many px (0: not at all, beside a corner chip; a little,
   * beside a bottom bar).
   */
  type Way = Partial<FitPadding> & { soft?: number };
  /**
   * Internal marks: `plainFooter`: a bottom bar the graph stays above (no
   * beside); `besideChip`: a corner chip already decided to lie beside.
   */
  type Control = FitRect & { plainFooter?: boolean; besideChip?: boolean };
  const besideWay = (r: FitRect): Way =>
    r.x + r.w / 2 < box.w / 2 ? { left: r.x + r.w + gap } : { right: box.w - r.x + gap };
  const solve = (controls: Control[]): Candidate | null => {
    const ways = controls.map((r): Way[] => {
      if (r.header) return [{ top: r.y + r.h + gap }];
      if (r.besideChip) return [besideWay(r)];
      if (r.footer && r.plainFooter) return [{ bottom: box.h - r.y + gap }];
      if (r.footer) {
        const onLeft = r.x + r.w / 2 < box.w / 2;
        return [
          { bottom: box.h - r.y + gap },
          onLeft ? { left: r.x + r.w + gap, soft: BAR_PUSH * box.w } : { right: box.w - r.x + gap, soft: BAR_PUSH * box.w },
        ];
      }
      if (r.corner) {
        const onLeft = r.x + r.w / 2 < box.w / 2;
        return [
          { top: r.y + r.h + gap },
          onLeft ? { left: r.x + r.w + gap, soft: 0 } : { right: box.w - r.x + gap, soft: 0 },
        ];
      }
      return [{ bottom: box.h - r.y + gap }, { top: r.y + r.h + gap }, { right: box.w - r.x + gap }, { left: r.x + r.w + gap }];
    });
    const candidates: Candidate[] = [];
    const widen = (pad: FitPadding, way: Way): FitPadding => ({
      top: Math.max(pad.top, way.top ?? 0),
      right: Math.max(pad.right, way.right ?? 0),
      bottom: Math.max(pad.bottom, way.bottom ?? 0),
      left: Math.max(pad.left, way.left ?? 0),
    });
    // `pad`: all the ways taken; `hard`: without the soft ones, to tell how
    // far a soft one moved the graph; `push`: the least push allowed.
    const visit = (i: number, pad: FitPadding, hard: FitPadding, push: number) => {
      if (i < ways.length) {
        for (const way of ways[i]) {
          const soft = way.soft != null;
          visit(i + 1, widen(pad, way), soft ? hard : widen(hard, way), soft ? Math.min(push, way.soft!) : push);
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
      // Beside a corner chip or a bottom bar only where it does not push the
      // graph aside itself, or only a little (other controls may).
      if ((pad.left !== hard.left || pad.right !== hard.right) && Math.abs(x - placeSpan(box.w, gw, hard.left, hard.right)) > push + 0.5) return;
      const shift = Math.abs(x - (box.w - gw) / 2) + Math.abs(y - (box.h - gh) / 2);
      candidates.push({ scale, x, y, shift });
    };
    visit(0, base, base, Infinity);
    let best: Candidate | null = null;
    for (const c of candidates) {
      const larger = !best || c.scale > best.scale * (1 + 1e-6);
      const asLarge = best != null && c.scale >= best.scale * (1 - 1e-6);
      if (larger || (asLarge && c.shift < best!.shift)) best = c;
    }
    return best;
  };

  // Below or beside a corner chip is decided first, with any bottom bar as a
  // plain bar the graph stays above: a control taking room (the pill opening)
  // only makes the graph smaller then, which clears the chip all the more, so
  // its top can only move up, never down. With the chip's side settled, the
  // graph may reach down beside the bar where the bar does not push it aside
  // (only larger, its top unchanged).
  let controls: Control[] = rects;
  if (rects.some((r) => r.corner) && rects.some((r) => r.footer)) {
    const decided = solve(rects.map((r) => (r.footer ? { ...r, plainFooter: true } : r)));
    controls = rects.map((r) => {
      if (!r.corner) return r;
      const beside = decided != null && decided.y < r.y + r.h + gap - 0.5;
      return beside ? { ...r, corner: false, besideChip: true } : { ...r, corner: false, header: true };
    });
  }
  const all = solve(controls);
  let chosen = all;
  if (controls.some((r) => r.optional)) {
    const required = solve(controls.filter((r) => !r.optional));
    if (required && (!all || all.scale < 0.5 * required.scale)) chosen = required;
  }
  chosen ??= solve([]);
  if (chosen) return { scale: chosen.scale, x: chosen.x, y: chosen.y };
  // Not even the base margins leave room: the whole box.
  const scale = Math.min(box.w / graph.w, box.h / graph.h, maxScale);
  return { scale, x: (box.w - graph.w * scale) / 2, y: (box.h - graph.h * scale) / 2 };
}
