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

/** The pill's animation button, which opens and closes the panel. */
const animationButton = (utils: ReturnType<typeof view>) => utils.getByRole('button', { name: 'Animation' });

/** Opens the (initially closed) panel from the pill, which starts the animation. */
async function startAnimation(utils: ReturnType<typeof view>) {
  await act(async () => {
    fireEvent.click(animationButton(utils));
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
  it('is offered (in the control pill) only for a view of an event log', () => {
    expect(view().queryByRole('button', { name: 'Animation' })).toBeNull();
    cleanup();
    const utils = view({ fileId: 7 });
    expect(animationButton(utils).closest('[data-pill-spot]')).not.toBeNull();
  });

  it('has the object type panel’s header, with a "Hide" button of its buttons’ height', async () => {
    const utils = view({ fileId: 7 });
    await startAnimation(utils);
    const animationHide = utils.getByRole('button', { name: 'Hide Animation' });
    const typesClose = utils.getByRole('button', { name: 'Hide object types' });
    expect(animationHide.textContent).toBe('Hide');
    // The same header row, and both buttons 24 px tall, so both headers are equally high.
    expect(animationHide.parentElement!.className).toBe(typesClose.parentElement!.className);
    for (const button of [animationHide, typesClose]) expect(button.className.split(' ')).toContain('h-6');
  });

  it('starts closed; the pill button opens the panel and starts the animation at once', async () => {
    const utils = view({ fileId: 7 });
    expect(utils.queryByTestId('ocdfg-animation-panel')).toBeNull();
    expect(animationButton(utils).getAttribute('aria-pressed')).toBe('false');
    await startAnimation(utils);
    expect(animationButton(utils).getAttribute('aria-pressed')).toBe('true');
    // No "Animate" click needed: the steps are loaded and the tokens are drawn.
    expect(utils.queryByRole('button', { name: 'Animate' })).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
    expect(dots(utils.container)).toBe(3);
    fireEvent.click(animationButton(utils));
    expect(utils.queryByTestId('ocdfg-animation-panel')).toBeNull();
  });

  it('starts again when reopened after Stop', async () => {
    const utils = view({ fileId: 7 });
    await startAnimation(utils);
    fireEvent.click(utils.getByTitle('Stop'));
    expect(dots(utils.container)).toBeNull();
    await startAnimation(utils);
    expect(dots(utils.container)).toBe(3);
  });

  it('shares the top right with the layout panel: opening one closes the other', async () => {
    const utils = view({ fileId: 7 });
    await startAnimation(utils);
    fireEvent.click(utils.getByRole('button', { name: 'Change the layout' }));
    expect(utils.queryByTestId('ocdfg-layout-panel')).not.toBeNull();
    expect(utils.queryByTestId('ocdfg-animation-panel')).toBeNull();
    await startAnimation(utils);
    expect(utils.queryByTestId('ocdfg-animation-panel')).not.toBeNull();
    expect(utils.queryByTestId('ocdfg-layout-panel')).toBeNull();
  });

  it('has no edge animation button any more', () => {
    const utils = view({ fileId: 7 });
    expect(utils.queryByTitle(/edge animation/)).toBeNull();
  });

  it('loads nothing until the animation is opened', () => {
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

    // Stop removes the tokens and closes the panel.
    fireEvent.click(utils.getByTitle('Stop'));
    expect(utils.container.querySelector('[data-testid="ocdfg-token-layer"]')).toBeNull();
    expect(utils.queryByTestId('ocdfg-animation-panel')).toBeNull();
    expect(animationButton(utils).getAttribute('aria-pressed')).toBe('false');
    expect(utils.queryByTestId('pill-toggle-running')).toBeNull();
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

  it('keeps animating while the panel is closed, with a dot on the pill button', async () => {
    const utils = view({ fileId: 7 });
    await startAnimation(utils);
    expect(utils.queryByTestId('pill-toggle-running')).toBeNull();
    fireEvent.click(utils.getByRole('button', { name: 'Hide Animation' }));
    expect(utils.queryByTestId('ocdfg-animation-panel')).toBeNull();
    expect(dots(utils.container)).toBe(3);
    expect(utils.queryByTestId('pill-toggle-running')).not.toBeNull();
  });

  it('shows the chart only as tall as the panel has room for, the chosen height otherwise', async () => {
    // happy-dom has no layout: the view is `viewHeight` tall, the panel's
    // content besides the chart takes 200 px, and offset parents are parents.
    const proto = HTMLElement.prototype;
    const saved = ['offsetParent', 'clientHeight', 'scrollHeight'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const,
    );
    let viewHeight = 0;
    const isPanel = (el: HTMLElement) =>
      el.parentElement?.dataset.testid === 'ocdfg-view' && el.querySelector('[data-testid="ocdfg-animation-panel"]') != null;
    Object.defineProperty(proto, 'offsetParent', { configurable: true, get() { return (this as HTMLElement).parentElement; } });
    Object.defineProperty(proto, 'clientHeight', {
      configurable: true,
      get() {
        return (this as HTMLElement).dataset.testid === 'ocdfg-view' ? viewHeight : 0;
      },
    });
    Object.defineProperty(proto, 'scrollHeight', {
      configurable: true,
      get() {
        const el = this as HTMLElement;
        if (!isPanel(el)) return 0;
        const plot = el.querySelector<HTMLElement>('[data-testid="ocdfg-activity-plot"]');
        return 200 + (plot ? parseFloat(plot.style.height) : 0);
      },
    });
    localStorage.setItem('ocdfg.animationPanelSize', JSON.stringify({ width: 300, chartHeight: 300 }));
    const plotHeight = (utils: ReturnType<typeof view>) => parseFloat(utils.getByTestId('ocdfg-activity-plot').style.height);
    try {
      // Plenty of room: the chosen 300 px.
      viewHeight = 2000;
      let utils = view({ fileId: 7 });
      await startAnimation(utils);
      expect(plotHeight(utils)).toBe(300);
      cleanup();
      // 500 px view: 500 − 16 top − 24 kept above the pill (in this 0 px wide
      // test view it counts as below the panel) − 200 for the rest: 260 px.
      viewHeight = 500;
      utils = view({ fileId: 7 });
      await startAnimation(utils);
      expect(plotHeight(utils)).toBe(260);
    } finally {
      localStorage.removeItem('ocdfg.animationPanelSize');
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(proto, key, descriptor);
        else delete (proto as unknown as Record<string, unknown>)[key];
      }
    }
  });

  it('sets the speed with a slider in steps of 1, 2, 5, shown as a multiplier', async () => {
    const utils = view({ fileId: 7 });
    await startAnimation(utils);
    // The steps run 0 → 200 s: played in ~30 s that is closest to 5×.
    const speedRow = () => utils.getByText('Speed').parentElement as HTMLElement;
    expect(speedRow().textContent).toBe('Speed5×');
    const thumb = utils.getByRole('slider', { name: 'Playback speed' });
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(speedRow().textContent).toBe('Speed10×');
    fireEvent.keyDown(thumb, { key: 'End' });
    expect(speedRow().textContent).toBe('Speed100M×');
    // No gear menu any more.
    expect(utils.queryByTitle(/Playback settings/)).toBeNull();
  });

  it('uses the chart as the timeline: the moment above the playhead, keys like a slider', async () => {
    const utils = view({ fileId: 7 });
    await startAnimation(utils);
    const chart = utils.getByTestId('ocdfg-activity-chart');
    // At the start the label and the line sit at the chart's left edge.
    expect(within(chart).getByTestId('ocdfg-animation-time').style.transform).toBe('translateX(0px)');
    const timeline = within(chart).getByRole('slider', { name: 'Animation time' });
    expect(timeline.getAttribute('aria-valuenow')).toBe('0');
    // The steps run 0 → 200 s: an arrow key moves 1 % (2 s), End to the end.
    fireEvent.keyDown(timeline, { key: 'ArrowRight' });
    expect(timeline.getAttribute('aria-valuenow')).toBe('2');
    fireEvent.keyDown(timeline, { key: 'End' });
    expect(timeline.getAttribute('aria-valuenow')).toBe('200');
    // No separate timeline slider: the chart is the only one.
    expect(utils.queryAllByRole('slider', { name: 'Animation time' })).toHaveLength(1);
    // Play sits with loop and stop.
    expect(utils.getByTitle('Play').parentElement!.contains(utils.getByTitle('Stop'))).toBe(true);
  });

  it('marks the highest value with a faint line and its number', async () => {
    const utils = view({ fileId: 7 });
    await startAnimation(utils);
    const chart = utils.getByTestId('ocdfg-activity-chart');
    expect(within(chart).getByTestId('ocdfg-activity-peak-line').getAttribute('stroke-dasharray')).toBe('3 3');
    // One line per object type; the highest is the two items between events at t = 0.
    expect(within(chart).getByTestId('ocdfg-activity-peak').textContent).toBe('2');
    // The number is shown once: no "peak …" in the chart's top row any more.
    expect(within(chart).queryByText(/^peak /)).toBeNull();
  });

  it('fades the other types’ tokens while a type is hovered in the legend', async () => {
    const utils = view({ fileId: 7 });
    await startAnimation(utils);
    const circles = () =>
      Array.from(utils.container.querySelector('[data-testid="ocdfg-token-layer"]')!.querySelectorAll('circle'));
    expect(circles().every((c) => !c.hasAttribute('opacity'))).toBe(true);
    const itemRow = utils.container.querySelector('[data-object-type="item"]')!;
    fireEvent.mouseEnter(itemRow);
    // The order fades and lies below; the two items stay and are drawn last.
    expect(circles().map((c) => c.getAttribute('opacity'))).toEqual(['0.15', null, null]);
    fireEvent.mouseLeave(itemRow);
    expect(circles().every((c) => !c.hasAttribute('opacity'))).toBe(true);
  });

  it('marks the lowest value too in the step balance, which goes below zero', async () => {
    const utils = view({ fileId: 7 });
    await startAnimation(utils);
    const chart = utils.getByTestId('ocdfg-activity-chart');
    // Objects between events never go below zero: no lower marker.
    expect(within(chart).queryByTestId('ocdfg-activity-trough')).toBeNull();
    await act(async () => {
      fireEvent.pointerDown(within(chart).getByRole('button', { name: /Objects between events/ }), {
        button: 0,
        ctrlKey: false,
        pointerType: 'mouse',
      });
    });
    await act(async () => {
      fireEvent.click(utils.getByRole('menuitemradio', { name: 'Step balance' }));
    });
    expect(within(chart).getByTestId('ocdfg-activity-trough-line').getAttribute('stroke-dasharray')).toBe('3 3');
    expect(within(chart).getByTestId('ocdfg-activity-trough').textContent).toMatch(/^[−-]/);
  });

  it('asks for variant ranks in the variants view', async () => {
    const utils = view({ fileId: 7, sliderMode: 'variants' });
    await startAnimation(utils);
    expect(get.mock.calls[0][0]).toBe('/api/new-ocdfg/flows/?file_id=7&variant_ranks=1');
  });
});
