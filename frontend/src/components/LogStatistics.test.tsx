// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const size = { width: 600, height: 0 };
vi.mock('./logStatisticsUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./logStatisticsUtils')>();
  return {
    ...actual,
    useLogStatistics: () => ({
      stats: {
        num_events: 1200,
        num_unique_activities: 12,
        num_objects: 300,
        num_object_types: 4,
        earliest_timestamp: 0,
        newest_timestamp: 86400,
      },
      loading: false,
      error: null,
    }),
    useElementSize: () => ({ ref: () => undefined, ...size }),
  };
});

import LogStatistics from './LogStatistics';

afterEach(() => cleanup());

/** The value's font size class of the first card. */
function valueClass(height: number, fitHeight: boolean) {
  size.height = height;
  const utils = render(<LogStatistics fileId={1} fitHeight={fitHeight} />);
  const value = utils.getByText(/^1\D?200$/);
  const cls = value.className;
  cleanup();
  return cls;
}

describe('LogStatistics', () => {
  it('keeps the regular cards while a row has room for them', () => {
    expect(valueClass(80, true)).toContain('text-lg');
  });

  it('makes the cards more compact instead of scrolling in a short tile', () => {
    expect(valueClass(50, true)).toContain('text-base');
    expect(valueClass(30, true)).toContain('text-sm');
  });

  it('stays regular without a set height (the overview page)', () => {
    expect(valueClass(30, false)).toContain('text-lg');
  });
});
