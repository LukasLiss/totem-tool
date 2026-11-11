import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../options';
import { fromStoredLayout, parseStoredLayout, toStoredLayout } from '../preferences';

const LR = { ...DEFAULT_OPTIONS, direction: 'LR' as const };

describe('stored layout preferences', () => {
  it('stores only the differences to the defaults', () => {
    expect(toStoredLayout(DEFAULT_OPTIONS, DEFAULT_OPTIONS)).toBeNull();
    const stored = toStoredLayout({ ...DEFAULT_OPTIONS, edgeStyle: 'orthogonal', rankGap: 80 }, DEFAULT_OPTIONS);
    expect(stored).toEqual({ version: 1, options: { edgeStyle: 'orthogonal', rankGap: 80 } });
    // Relative to the view's defaults: LR is no difference for a view whose default is LR.
    expect(toStoredLayout(LR, LR)).toBeNull();
  });

  it('never stores the data filters the legends own', () => {
    const stored = toStoredLayout({ ...DEFAULT_OPTIONS, hiddenTypes: ['a'], variantCoverage: 0.5, arcThreshold: 0.2 }, DEFAULT_OPTIONS);
    expect(stored).toBeNull();
  });

  it('round-trips', () => {
    const options = {
      ...DEFAULT_OPTIONS,
      edgeStyle: 'octilinear' as const,
      laneOrder: 'manual' as const,
      manualLaneOrder: ['b', 'a'],
      mergePoints: true,
      arcLabels: 'frequency' as const,
      arrowSize: 1.5,
    };
    expect(fromStoredLayout(toStoredLayout(options, DEFAULT_OPTIONS), DEFAULT_OPTIONS)).toEqual(options);
  });

  it('uses the defaults when nothing is stored', () => {
    expect(fromStoredLayout(null, LR)).toBe(LR);
    expect(fromStoredLayout(undefined, LR)).toBe(LR);
  });

  it.each([
    ['a string', 'orthogonal'],
    ['an array', [1, 2]],
    ['no version', { options: {} }],
    ['another version', { version: 2, options: {} }],
    ['extra top-level keys', { version: 1, options: {}, extra: true }],
    ['options not an object', { version: 1, options: [] }],
    ['an unknown option', { version: 1, options: { edgeStyle: 'orthogonal', wobble: 3 } }],
    ['a data filter', { version: 1, options: { hiddenTypes: ['a'] } }],
    ['an unknown choice', { version: 1, options: { edgeStyle: 'zigzag' } }],
    ['a number out of range', { version: 1, options: { rankGap: 9000 } }],
    ['a number of the wrong type', { version: 1, options: { rankGap: '56' } }],
    ['NaN', { version: 1, options: { arrowSize: Number.NaN } }],
    ['a switch that is no boolean', { version: 1, options: { arcHalo: 'yes' } }],
    ['a bad lane list', { version: 1, options: { manualLaneOrder: ['a', 3] } }],
    ['min. width above max. width', { version: 1, options: { minWidth: 7, maxWidth: 2 } }],
  ])('falls back to the defaults for %s', (_name, raw) => {
    expect(parseStoredLayout(raw) === null || fromStoredLayout(raw, LR) === LR).toBe(true);
    expect(fromStoredLayout(raw, LR)).toEqual(LR);
  });

  it('applies valid entries on top of the view defaults', () => {
    const options = fromStoredLayout({ version: 1, options: { selfLoopStyle: 'badge' } }, LR);
    expect(options.selfLoopStyle).toBe('badge');
    expect(options.direction).toBe('LR');
  });
});
