import { describe, expect, it } from 'vitest';
import { pillRegion, type PillSpot } from '@/components/canvas/pillSpots';
import { bestFit, pillRect, placeSpan, type FitPadding, type FitRect } from '../fitMargins';

const BASE: FitPadding = { top: 24, right: 24, bottom: 24, left: 24 };
/** The DFG pill: 340 × 70 lying, 70 × 560 standing at a side. */
const pill = (spot: PillSpot, box: { w: number; h: number }) =>
  pillRect(
    pillRegion(spot, spot === 'left' || spot === 'right' ? { width: 70, height: 560 } : { width: 340, height: 70 }, {
      width: box.w,
      height: box.h,
    }),
  );
const TITLE: FitRect = { x: 16, y: 16, w: 340, h: 30, header: true };
const LEGEND_CHIP: FitRect = { x: 16, y: 54, w: 240, h: 30 };
const playChip = (box: { w: number }): FitRect => ({ x: box.w - 46, y: 16, w: 30, h: 30, header: true });

describe('bestFit', () => {
  it('slides a wide graph below the open legend instead of squeezing it beside it', () => {
    // The card of the screenshot: about 855 × 700 px, legend open, pill in the right middle.
    const box = { w: 855, h: 700 };
    const legend: FitRect = { x: 16, y: 54, w: 280, h: 200, optional: true };
    const fit = bestFit(box, { w: 1000, h: 590 }, BASE, [TITLE, legend, playChip(box), pill('right', box)], 1.4);
    // Below the legend (254 + 24) and left of the pill, filling that height: 398 / 590.
    expect(fit.y).toBeGreaterThanOrEqual(278);
    expect(fit.scale).toBeCloseTo(398 / 590, 5);
    // Beside the legend it would only get (855 − 320 − 110) / 1000 = 0.425.
    expect(fit.scale).toBeGreaterThan(0.6);
  });

  it('starts the graph below the title row, but may set it beside the legend chip', () => {
    const box = { w: 1200, h: 900 };
    // A square graph is larger beside the chip (from below the title) than below the chip.
    const fit = bestFit(box, { w: 1000, h: 1000 }, BASE, [TITLE, LEGEND_CHIP, playChip(box)], 1.4);
    expect(fit.y).toBeCloseTo(16 + 30 + 24, 5);
    expect(fit.scale).toBeCloseTo((900 - 70 - 24) / 1000, 5);
    expect(fit.x).toBeGreaterThanOrEqual(LEGEND_CHIP.x + LEGEND_CHIP.w + 24);
  });

  it('gives the graph the same room with the legend collapsed as with it open, where both fit beside it', () => {
    const box = { w: 1650, h: 780 };
    const graph = { w: 900, h: 660 };
    const title: FitRect = { x: 16, y: 16, w: 340, h: 30, header: true };
    const chip: FitRect = { x: 16, y: 54, w: 240, h: 34 };
    const panel: FitRect = { x: 16, y: 54, w: 250, h: 340, optional: true };
    const collapsed = bestFit(box, graph, BASE, [title, chip, playChip(box)], 1.4);
    const open = bestFit(box, graph, BASE, [title, panel, playChip(box)], 1.4);
    expect(collapsed.scale).toBeCloseTo(open.scale, 5);
  });

  it('centres a wide graph between the collapsed legend and a bottom pill', () => {
    const box = { w: 1200, h: 900 };
    const bottomPill = pill('bottom-left', box);
    const fit = bestFit(box, { w: 1600, h: 800 }, BASE, [TITLE, LEGEND_CHIP, playChip(box), bottomPill], 1.4);
    const free = { top: 54 + 30 + 24, bottom: bottomPill.y - 24 };
    // Above the pill (beside it would leave the graph narrower), the full free width wide …
    expect(fit.scale).toBeCloseTo((1200 - 48) / 1600, 5);
    expect(fit.y + 800 * fit.scale).toBeLessThanOrEqual(free.bottom);
    // … and about as far from the chip as from the pill.
    const gapAbove = fit.y - free.top;
    const gapBelow = free.bottom - (fit.y + 800 * fit.scale);
    expect(Math.abs(gapAbove - gapBelow)).toBeLessThan(4);
  });

  it('may set a tall graph beside a corner pill when that shows it larger', () => {
    const box = { w: 1200, h: 900 };
    const bottomPill = pill('bottom-left', box);
    const fit = bestFit(box, { w: 600, h: 1000 }, BASE, [TITLE, LEGEND_CHIP, bottomPill], 1.4);
    // Right of the pill (and the chip), from below the title to the bottom margin: (900 − 70 − 24) / 1000.
    expect(fit.scale).toBeCloseTo(806 / 1000, 5);
    expect(fit.x).toBeGreaterThanOrEqual(bottomPill.x + bottomPill.w + 24);
  });

  it('keeps a graph with room to spare where it is when the pill changes sides', () => {
    const box = { w: 1200, h: 900 };
    const small = { w: 300, h: 200 };
    const left = bestFit(box, small, BASE, [TITLE, LEGEND_CHIP, pill('left', box)], 1.4);
    const right = bestFit(box, small, BASE, [TITLE, LEGEND_CHIP, pill('right', box)], 1.4);
    expect(left).toEqual(right);
    expect(left.scale).toBe(1.4);
    expect(left.x).toBeCloseTo((1200 - 300 * 1.4) / 2, 5);
  });

  it('lets a large panel lie over the graph where making room would halve it', () => {
    // A narrow box: an open legend 280 px wide and 400 px tall leaves little room either way.
    const box = { w: 400, h: 500 };
    const legend: FitRect = { x: 16, y: 16, w: 280, h: 400, optional: true };
    const withPanel = bestFit(box, { w: 400, h: 400 }, BASE, [legend], 1.4);
    const without = bestFit(box, { w: 400, h: 400 }, BASE, [], 1.4);
    expect(withPanel).toEqual(without);
  });

  it('fits into the whole box when not even the margins leave room', () => {
    const fit = bestFit({ w: 40, h: 40 }, { w: 100, h: 100 }, { top: 30, right: 30, bottom: 30, left: 30 }, [], 1.4);
    expect(fit.scale).toBeCloseTo(0.4, 5);
  });
});

describe('placeSpan', () => {
  it('keeps a graph with room to spare centred, whichever side a control is on', () => {
    // 1200 px box, 600 px graph: centred at 300 with 110 px free on the left or on the right.
    expect(placeSpan(1200, 600, 110, 24)).toBe(300);
    expect(placeSpan(1200, 600, 24, 110)).toBe(300);
  });

  it('moves the graph only as far as a control would cover it', () => {
    // 1000 px graph centred at 100 would run under 150 px on the left: start at 150.
    expect(placeSpan(1200, 1000, 150, 24)).toBe(150);
    // … or under 150 px on the right: end at 1050.
    expect(placeSpan(1200, 1000, 24, 150)).toBe(50);
  });

  it('centres a graph in the free room when it fills it', () => {
    expect(placeSpan(1200, 1000, 100, 100)).toBe(100);
    // Larger than the room: centred in it.
    expect(placeSpan(1200, 1100, 100, 100)).toBe(50);
  });
});
