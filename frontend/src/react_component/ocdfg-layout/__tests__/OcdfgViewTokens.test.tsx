// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { get } }));

import OcdfgView from '../OcdfgView';
import { fromTraces } from '../graph';
import { DEFAULT_OPTIONS } from '../options';
import type { FlowsPayload } from '../tokenAnimation';

const graph = fromTraces({
  order: [[['place', 'pack', 'ship'], 1]],
  item: [[['place', 'pack'], 2]],
});

/** At t = 0 all three objects leave "place"; o1's second step runs 100 → 200. */
const payload: FlowsPayload = {
  activities: ['pack', 'place', 'ship'],
  object_types: ['item', 'order'],
  objects: { type: [1, 0, 0], variant_rank: null },
  flows: {
    object: [0, 1, 2, 0],
    source: [1, 1, 1, 0],
    target: [0, 0, 0, 2],
    start: [0, 0, 0, 100],
    duration: [100, 50, 50, 100],
  },
  total_objects: 3,
};

function view(props: Partial<React.ComponentProps<typeof OcdfgView>> = {}) {
  return render(<OcdfgView graph={graph} height={600} sliderMode="weight" layoutDefaults={DEFAULT_OPTIONS} {...props} />);
}

async function startAnimation(utils: ReturnType<typeof view>) {
  await act(async () => {
    fireEvent.click(utils.getByRole('button', { name: 'Animate' }));
  });
}

const dots = (container: HTMLElement) =>
  container.querySelector('[data-testid="ocdfg-token-layer"]')?.querySelectorAll('circle').length ?? null;

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: payload });
});
afterEach(() => cleanup());

describe('OcdfgView animation panel', () => {
  it('is offered only for a view of an event log', () => {
    expect(view().queryByTestId('ocdfg-animation-panel')).toBeNull();
    cleanup();
    const utils = view({ fileId: 7 });
    expect(utils.queryByTestId('ocdfg-animation-panel')).not.toBeNull();
    expect(utils.queryByRole('button', { name: 'Animate' })).not.toBeNull();
  });

  it('loads nothing until Animate is clicked', () => {
    view({ fileId: 7 });
    expect(get).not.toHaveBeenCalled();
  });

  it('loads the steps on demand, draws the running tokens and charts them', async () => {
    const utils = view({ fileId: 7 });
    await startAnimation(utils);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe('/api/new-ocdfg/flows/?file_id=7');
    // Paused at the start: the three steps leaving "place" are on their arcs.
    expect(dots(utils.container)).toBe(3);

    const chart = utils.getByTestId('ocdfg-activity-chart');
    expect(within(chart).getByText('Objects between events')).not.toBeNull();
    // Legend values at t = 0: one order and two items between events.
    expect(within(chart).getByTitle('order · click to show only this').textContent).toBe('1');
    expect(within(chart).getByTitle('item · click to show only this').textContent).toBe('2');

    // Stop removes the tokens and offers Animate again.
    fireEvent.click(utils.getByTitle('Stop'));
    expect(utils.container.querySelector('[data-testid="ocdfg-token-layer"]')).toBeNull();
    expect(utils.queryByRole('button', { name: 'Animate' })).not.toBeNull();
  });

  it('fades the arcs while the tokens are shown, not the activities', async () => {
    const utils = view({ fileId: 7 });
    const arcLayer = () => utils.getByTestId('ocdfg-arc-layer');
    expect(arcLayer().getAttribute('opacity')).toBeNull();
    await startAnimation(utils);
    expect(arcLayer().getAttribute('opacity')).toBe('0.3');
    expect(arcLayer().querySelector('[data-testid^="ocdfg-node"], text')).toBeNull();
    fireEvent.click(utils.getByTitle('Stop'));
    expect(arcLayer().getAttribute('opacity')).toBeNull();
  });

  it('neither draws nor charts hidden object types', async () => {
    const utils = view({ fileId: 7 });
    await act(async () => {
      fireEvent.click(utils.getByLabelText('Show item'));
    });
    await startAnimation(utils);
    expect(dots(utils.container)).toBe(1);
    const chart = utils.getByTestId('ocdfg-activity-chart');
    expect(within(chart).queryByTitle('item · click to show only this')).toBeNull();
    expect(within(chart).getByTitle('order · click to show only this').textContent).toBe('1');
  });

  it('keeps animating while the panel is collapsed', async () => {
    const utils = view({ fileId: 7 });
    await startAnimation(utils);
    fireEvent.click(utils.getByRole('button', { name: 'Hide Animation' }));
    expect(utils.queryByTestId('ocdfg-animation-panel')).toBeNull();
    expect(dots(utils.container)).toBe(3);
  });

  it('asks for variant ranks in the variants view', async () => {
    const utils = view({ fileId: 7, sliderMode: 'variants' });
    await startAnimation(utils);
    expect(get.mock.calls[0][0]).toBe('/api/new-ocdfg/flows/?file_id=7&variant_ranks=1');
  });
});
