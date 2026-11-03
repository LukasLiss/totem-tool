// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OcdfgView from '../OcdfgView';
import { fromTraces } from '../graph';
import { DEFAULT_OPTIONS } from '../options';

const graph = fromTraces({
  order: [
    [['place', 'pay', 'ship'], 5],
    [['place', 'pay', 'pay', 'ship'], 2],
  ],
  item: [[['place', 'pick', 'ship'], 8]],
});

function view(props: Partial<React.ComponentProps<typeof OcdfgView>> = {}) {
  const saveLayout = vi.fn();
  const utils = render(
    <OcdfgView graph={graph} height={600} sliderMode="weight" layoutDefaults={DEFAULT_OPTIONS} saveLayout={saveLayout} {...props} />,
  );
  return { ...utils, saveLayout };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('OcdfgView', () => {
  it('replaces the dim-terminal button by a layout button that opens the panel', () => {
    const { queryByTitle, queryByTestId, getByRole } = view();
    expect(queryByTitle('Dim edges touching start/end')).toBeNull();
    expect(queryByTestId('ocdfg-layout-panel')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Change the layout' }));
    expect(queryByTestId('ocdfg-layout-panel')).not.toBeNull();
    fireEvent.click(getByRole('button', { name: 'Close layout panel' }));
    expect(queryByTestId('ocdfg-layout-panel')).toBeNull();
  });

  it('draws self loops on the side by default', () => {
    const { container } = view();
    // The side loop is a teardrop path, not a badge circle with ↻.
    expect(container.textContent).not.toContain('↻');
  });

  it('saves changes (debounced) and removes them with "Reset to defaults"', () => {
    const { getByRole, getByLabelText, saveLayout } = view();
    fireEvent.click(getByRole('button', { name: 'Change the layout' }));
    fireEvent.change(getByLabelText('Arc routing'), { target: { value: 'orthogonal' } });
    fireEvent.change(getByLabelText('Self loops'), { target: { value: 'badge' } });
    expect(saveLayout).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(saveLayout).toHaveBeenCalledTimes(1);
    expect(saveLayout).toHaveBeenLastCalledWith({ version: 1, options: { edgeStyle: 'orthogonal', selfLoopStyle: 'badge' } });

    fireEvent.click(getByRole('button', { name: /Reset to defaults/ }));
    act(() => vi.advanceTimersByTime(1000));
    expect(saveLayout).toHaveBeenLastCalledWith(null);
    expect((getByLabelText('Arc routing') as HTMLSelectElement).value).toBe(DEFAULT_OPTIONS.edgeStyle);
  });

  it('starts from the stored layout and ignores broken entries', () => {
    const stored = { version: 1, options: { edgeStyle: 'octilinear' } };
    const first = view({ storedLayout: stored });
    fireEvent.click(first.getByRole('button', { name: 'Change the layout' }));
    expect((first.getByLabelText('Arc routing') as HTMLSelectElement).value).toBe('octilinear');
    cleanup();

    const broken = view({ storedLayout: { version: 1, options: { edgeStyle: 'zigzag' } } });
    fireEvent.click(broken.getByRole('button', { name: 'Change the layout' }));
    expect((broken.getByLabelText('Arc routing') as HTMLSelectElement).value).toBe(DEFAULT_OPTIONS.edgeStyle);
  });

  it('picks up a stored layout that arrives after the first render', () => {
    const { rerender, getByRole, getByLabelText } = view({ storedLayout: undefined });
    fireEvent.click(getByRole('button', { name: 'Change the layout' }));
    rerender(
      <OcdfgView
        graph={graph}
        height={600}
        sliderMode="weight"
        layoutDefaults={DEFAULT_OPTIONS}
        storedLayout={{ version: 1, options: { edgeStyle: 'spline' } }}
      />,
    );
    expect((getByLabelText('Arc routing') as HTMLSelectElement).value).toBe('spline');
  });

  it('has no layout button in the process-area drill-down', () => {
    const onSizeChange = vi.fn();
    const { queryByRole, queryByTestId } = view({ variant: 'detail', layoutEditable: false, onSizeChange });
    expect(queryByRole('button', { name: 'Change the layout' })).toBeNull();
    expect(queryByTestId('ocdfg-legend')).toBeNull();
    expect(onSizeChange).toHaveBeenCalled();
  });

  it('hides the arcs of a switched-off object type', () => {
    const { container, getByLabelText } = view();
    expect(container.querySelector('[data-arc-id="pick→ship@item"]')).not.toBeNull();
    fireEvent.click(getByLabelText('Show item'));
    expect(container.querySelector('[data-arc-id="pick→ship@item"]')).toBeNull();
    expect(container.querySelector('[data-node-id="pick"]')).toBeNull();
  });
});
