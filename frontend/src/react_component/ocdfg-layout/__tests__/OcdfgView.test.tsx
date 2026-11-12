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
  it('puts its toolbar into the shared movable pill, bottom left by default', () => {
    const { getByRole } = view();
    const pill = getByRole('button', { name: 'Zoom in' }).closest('[data-pill-spot]') as HTMLElement;
    expect(pill.dataset.pillSpot).toBe('bottom-left');
    expect(getByRole('button', { name: 'Collapse the controls' })).not.toBeNull();
  });

  it('shows the fit mode on the fit button until the user zooms, and again after fitting', () => {
    const { getByRole } = view();
    const fit = () => getByRole('button', { name: 'Fit to view' });
    expect(fit().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(getByRole('button', { name: 'Zoom in' }));
    expect(fit().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(fit());
    expect(fit().getAttribute('aria-pressed')).toBe('true');
  });

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

  it('ends the legend above the control pill when the pill is on its side', () => {
    // happy-dom has no layout: give elements their parent as offset parent and
    // a 1000 px wide canvas; heights and the pill's size stay 0.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    const originalWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get() {
        return (this as HTMLElement).parentElement;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
    try {
      const legendColumn = (utils: ReturnType<typeof view>) =>
        utils.getByTestId('ocdfg-legend').parentElement as HTMLElement;
      localStorage.setItem('controlPill:ocdfg:default', JSON.stringify({ spot: 'bottom-left', collapsed: false }));
      let utils = view();
      // Canvas 0 px tall, pill at its bottom (top −16): the column keeps 16 + 8 px more free below.
      expect(legendColumn(utils).style.maxHeight).toBe('calc(100% - 40px)');
      cleanup();
      localStorage.setItem('controlPill:ocdfg:default', JSON.stringify({ spot: 'bottom-right', collapsed: false }));
      utils = view();
      expect(legendColumn(utils).style.maxHeight).toBe('calc(100% - 32px)');
    } finally {
      localStorage.removeItem('controlPill:ocdfg:default');
      if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original);
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      if (originalWidth) Object.defineProperty(Element.prototype, 'clientWidth', originalWidth);
    }
  });

  it('folds the per-type sliders into the object type panel', () => {
    const { getByRole, queryByRole } = view();
    expect(queryByRole('slider', { name: 'Minimum arc weight of order' })).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Unfold order settings' }));
    expect(getByRole('slider', { name: 'Minimum arc weight of order' })).not.toBeNull();
  });

  it('shows a variant filter on the folded line in the variants view', () => {
    const { getByRole, getByText } = view({ sliderMode: 'variants' });
    fireEvent.click(getByRole('button', { name: 'Unfold order settings' }));
    const slider = getByRole('slider', { name: 'Variants of order' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.click(getByRole('button', { name: 'Fold order settings' }));
    expect(getByText('1/2')).not.toBeNull();
  });

  it('hides the arcs of a switched-off object type', () => {
    const { container, getByLabelText } = view();
    expect(container.querySelector('[data-arc-id="pick→ship@item"]')).not.toBeNull();
    fireEvent.click(getByLabelText('Show item'));
    expect(container.querySelector('[data-arc-id="pick→ship@item"]')).toBeNull();
    expect(container.querySelector('[data-node-id="pick"]')).toBeNull();
  });
});
