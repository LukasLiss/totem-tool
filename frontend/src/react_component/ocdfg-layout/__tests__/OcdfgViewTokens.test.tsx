// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
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

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: payload });
});
afterEach(() => cleanup());

describe('OcdfgView token animation', () => {
  it('offers the animation only for a view of an event log', () => {
    expect(view().queryByRole('button', { name: 'Animate the objects' })).toBeNull();
    cleanup();
    expect(view({ fileId: 7 }).queryByRole('button', { name: 'Animate the objects' })).not.toBeNull();
  });

  it('loads nothing until the animation is switched on', () => {
    view({ fileId: 7 });
    expect(get).not.toHaveBeenCalled();
  });

  it('loads the steps on demand and draws the running tokens', async () => {
    const { getByRole, queryByTestId, container } = view({ fileId: 7 });
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Animate the objects' }));
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe('/api/new-ocdfg/flows/?file_id=7');
    expect(queryByTestId('ocdfg-token-playback')).not.toBeNull();
    // Paused at the start: the three steps leaving "place" are on their arcs.
    const layer = container.querySelector('[data-testid="ocdfg-token-layer"]')!;
    expect(layer.querySelectorAll('circle')).toHaveLength(3);

    // Closing removes the bar and the layer.
    fireEvent.click(getByRole('button', { name: 'Close the animation' }));
    expect(queryByTestId('ocdfg-token-playback')).toBeNull();
    expect(container.querySelector('[data-testid="ocdfg-token-layer"]')).toBeNull();
  });

  it('draws no tokens of hidden object types', async () => {
    const { getByRole, getByLabelText, container } = view({ fileId: 7 });
    await act(async () => {
      fireEvent.click(getByLabelText('Show item'));
    });
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Animate the objects' }));
    });
    const layer = container.querySelector('[data-testid="ocdfg-token-layer"]')!;
    expect(layer.querySelectorAll('circle')).toHaveLength(1);
  });

  it('asks for variant ranks in the variants view', async () => {
    const { getByRole } = view({ fileId: 7, sliderMode: 'variants' });
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Animate the objects' }));
    });
    expect(get.mock.calls[0][0]).toBe('/api/new-ocdfg/flows/?file_id=7&variant_ranks=1');
  });
});
