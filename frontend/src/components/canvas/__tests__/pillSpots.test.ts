import { describe, expect, it } from 'vitest';
import { panelAtPill, pillRegion } from '../pillSpots';

const CANVAS = { width: 1000, height: 600 };
const LYING = { width: 400, height: 50 };
const STANDING = { width: 50, height: 400 };

describe('panelAtPill', () => {
  it('opens above a pill in a bottom corner, flush with its outer edge', () => {
    // Pill bottom right: top 534, right edge 16 px from the canvas edge.
    expect(panelAtPill(pillRegion('bottom-right', LYING, CANVAS))).toEqual({ right: 16, bottom: 74, maxHeight: 510 });
    expect(panelAtPill(pillRegion('bottom-left', LYING, CANVAS))).toEqual({ left: 16, bottom: 74, maxHeight: 510 });
  });

  it('opens beside a pill standing at an edge, bottom edges level', () => {
    // Standing pill: 100 … 500 px from the top.
    expect(panelAtPill(pillRegion('left', STANDING, CANVAS))).toEqual({ left: 74, bottom: 100, maxHeight: 484 });
    expect(panelAtPill(pillRegion('right', STANDING, CANVAS))).toEqual({ right: 74, bottom: 100, maxHeight: 484 });
  });

  it('opens below a pill in a top corner', () => {
    expect(panelAtPill(pillRegion('top-right', LYING, CANVAS))).toEqual({ right: 16, top: 74, maxHeight: 510 });
  });

  it('falls back to above the bottom-right corner while the pill is not measured', () => {
    expect(panelAtPill(null)).toEqual({ bottom: 74, right: 16, maxHeight: 'calc(100% - 90px)' });
  });
});
