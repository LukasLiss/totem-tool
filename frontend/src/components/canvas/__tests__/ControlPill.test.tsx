// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlPill } from '../ControlPill';
import { isVerticalSpot, nearestSpot, pillRegion, roomBelowForPill, type PillSpot } from '../pillSpots';

const ALL: PillSpot[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right'];
const box = { width: 1000, height: 600 };

describe('nearestSpot', () => {
  it('snaps to the closest corner or side centre', () => {
    expect(nearestSpot({ x: 50, y: 40 }, box, ALL)).toBe('top-left');
    expect(nearestSpot({ x: 980, y: 590 }, box, ALL)).toBe('bottom-right');
    expect(nearestSpot({ x: 30, y: 310 }, box, ALL)).toBe('left');
    expect(nearestSpot({ x: 990, y: 280 }, box, ALL)).toBe('right');
  });

  it('only picks allowed spots', () => {
    expect(nearestSpot({ x: 50, y: 40 }, box, ['bottom-left', 'bottom-right'])).toBe('bottom-left');
    expect(nearestSpot({ x: 30, y: 310 }, box, ['bottom-right', 'top-right'])).toBe('bottom-right');
  });

  it('turns the pill vertical only at the side centres', () => {
    expect(ALL.filter(isVerticalSpot)).toEqual(['left', 'right']);
  });
});

describe('pill region and the room panels keep free for it', () => {
  const size = { width: 300, height: 48 };
  const canvas = { width: 1000, height: 600 };

  it('places the pill box from its spot', () => {
    expect(pillRegion('bottom-left', size, canvas)).toMatchObject({ top: 536, left: 16 });
    expect(pillRegion('bottom-right', size, canvas)).toMatchObject({ top: 536, left: 684 });
    expect(pillRegion('top-right', size, canvas, 40)).toMatchObject({ top: 56, left: 684 });
    expect(pillRegion('left', { width: 48, height: 300 }, canvas)).toMatchObject({ top: 150, left: 16 });
  });

  it('makes a panel on the pill side end above it', () => {
    // 600 − 536 + 8: the panel stops 8 px above the pill.
    expect(roomBelowForPill(pillRegion('bottom-left', size, canvas), true)).toBe(72);
    expect(roomBelowForPill(pillRegion('left', { width: 48, height: 300 }, canvas), true)).toBe(458);
    expect(roomBelowForPill(pillRegion('bottom-right', size, canvas), false)).toBe(72);
  });

  it('leaves a panel alone when the pill is elsewhere', () => {
    expect(roomBelowForPill(null, true)).toBe(16);
    expect(roomBelowForPill(pillRegion('bottom-right', size, canvas), true)).toBe(16);
    expect(roomBelowForPill(pillRegion('top-right', size, canvas), false)).toBe(16);
    expect(roomBelowForPill(pillRegion('bottom-left', size, canvas), false, { fallback: 20 })).toBe(20);
  });

  it('counts a wide bottom pill reaching under the panel', () => {
    const wide = pillRegion('bottom-right', { width: 800, height: 48 }, canvas); // left = 184
    expect(roomBelowForPill(wide, true, { reach: 336 })).toBe(72);
    expect(roomBelowForPill(wide, true, { reach: 150 })).toBe(16);
  });
});

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

function movablePill(props: Partial<React.ComponentProps<typeof ControlPill>> = {}) {
  const utils = render(
    <div data-testid="canvas" style={{ position: 'relative' }}>
      <ControlPill spots={['bottom-left', 'bottom-right', 'left', 'right']} storageKey="test" {...props}>
        <button type="button">Zoom in</button>
      </ControlPill>
    </div>,
  );
  const root = utils.container.querySelector('[data-pill-spot]') as HTMLElement;
  return { ...utils, root, grip: () => utils.getByRole('button', { name: /controls/ }) };
}

beforeEach(() => {
  localStorage.clear();
  if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => cleanup());

describe('ControlPill', () => {
  it('stays the fixed bottom-right bar without spots', () => {
    const { container } = render(
      <ControlPill>
        <button type="button">Zoom in</button>
      </ControlPill>,
    );
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.style.bottom).toBe('12px');
    expect(bar.style.right).toBe('12px');
    expect(container.querySelector('[data-pill-spot]')).toBeNull();
  });

  it('renders nothing without controls', () => {
    const { container } = render(<ControlPill spots={['bottom-left']}>{false}</ControlPill>);
    expect(container.innerHTML).toBe('');
  });

  it('starts at its first spot, horizontal', () => {
    const { root } = movablePill();
    expect(root.dataset.pillSpot).toBe('bottom-left');
    expect(root.dataset.pillOrientation).toBe('horizontal');
  });

  it('collapses and expands on a click on the grip, and remembers it', () => {
    const { grip, queryByText } = movablePill();
    fireEvent.pointerDown(grip(), { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(grip(), { clientX: 10, clientY: 10, pointerId: 1 });
    expect(queryByText('Zoom in')).toBeNull();
    expect(JSON.parse(localStorage.getItem('controlPill:test')!)).toEqual({ spot: 'bottom-left', collapsed: true });
    fireEvent.keyDown(grip(), { key: 'Enter' });
    expect(queryByText('Zoom in')).not.toBeNull();
  });

  /** A pill in a 1000×600 canvas whose grip measures 20×36 at (20, 550). */
  function draggablePill(props: Partial<React.ComponentProps<typeof ControlPill>> = {}) {
    const utils = movablePill(props);
    const canvas = utils.getByTestId('canvas');
    Object.defineProperty(utils.root, 'offsetParent', { value: canvas, configurable: true });
    canvas.getBoundingClientRect = () => rect(0, 0, 1000, 600);
    const grip = utils.grip();
    grip.getBoundingClientRect = () => rect(20, 550, 20, 36);
    const bar = utils.root.firstElementChild as HTMLElement;
    const at = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1 });
    return { ...utils, grip, bar, at };
  }

  it('takes the shape of the spot under the cursor while dragging and lands there', () => {
    const { root, grip, bar, at } = draggablePill();
    fireEvent.pointerDown(grip, { button: 0, ...at(30, 560) });

    // Near the middle of the right edge: vertical already while dragging.
    fireEvent.pointerMove(grip, at(950, 290));
    expect(root.dataset.pillOrientation).toBe('vertical');
    expect(root.dataset.pillSpot).toBe('bottom-left'); // not committed yet
    expect(root.hasAttribute('data-pill-dragging')).toBe(true);

    // Near the bottom-right corner: horizontal again, grip at the right end.
    fireEvent.pointerMove(grip, at(950, 580));
    expect(root.dataset.pillOrientation).toBe('horizontal');
    expect(grip.dataset.pillGrip).toBe('end');
    expect(grip.style.order).toBe('1');
    // The grip stays under the cursor: grip centre (30, 568) + press offset (0, −8) → cursor.
    expect(bar.style.transform).toBe('translate(920px, 20px)');

    fireEvent.pointerUp(grip, at(950, 580));
    expect(root.dataset.pillSpot).toBe('bottom-right');
    expect(root.hasAttribute('data-pill-dragging')).toBe(false);
    expect(JSON.parse(localStorage.getItem('controlPill:test')!).spot).toBe('bottom-right');
    // The same grip element survived the drag (its pointer capture with it).
    expect(root.querySelector('[data-pill-grip]')).toBe(grip);
  });

  it('lands vertical at a side spot', () => {
    const { root, grip, at } = draggablePill();
    fireEvent.pointerDown(grip, { button: 0, ...at(30, 560) });
    fireEvent.pointerMove(grip, at(40, 300));
    fireEvent.pointerUp(grip, at(40, 300));
    expect(root.dataset.pillSpot).toBe('left');
    expect(root.dataset.pillOrientation).toBe('vertical');
    expect(grip.dataset.pillGrip).toBe('start');
  });

  it('goes back to its spot when the drag is cancelled', () => {
    const { root, grip, at } = draggablePill();
    fireEvent.pointerDown(grip, { button: 0, ...at(30, 560) });
    fireEvent.pointerMove(grip, at(950, 290));
    fireEvent.pointerCancel(grip, at(950, 290));
    expect(root.dataset.pillSpot).toBe('bottom-left');
    expect(root.dataset.pillOrientation).toBe('horizontal');
  });

  it('keeps its grip at the right end in a right corner', () => {
    const { root } = movablePill({ spots: ['bottom-right', 'bottom-left'] });
    const grip = root.querySelector('[data-pill-grip]') as HTMLElement;
    expect(grip.dataset.pillGrip).toBe('end');
    expect(grip.style.order).toBe('1');
  });

  it('comes back where it was left, ignoring spots the component no longer offers', () => {
    localStorage.setItem('controlPill:test', JSON.stringify({ spot: 'right', collapsed: false }));
    expect(movablePill().root.dataset.pillSpot).toBe('right');
    cleanup();
    localStorage.setItem('controlPill:test', JSON.stringify({ spot: 'top-left', collapsed: false }));
    expect(movablePill().root.dataset.pillSpot).toBe('bottom-left');
  });

  it('reports where it sits after a drop, not while dragging', () => {
    const onRegionChange = vi.fn();
    const { root, grip, bar, at } = draggablePill({ onRegionChange });
    const canvas = root.offsetParent as HTMLElement;
    Object.defineProperty(canvas, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(bar, 'offsetWidth', { value: 300, configurable: true });
    Object.defineProperty(bar, 'offsetHeight', { value: 48, configurable: true });
    onRegionChange.mockClear();

    fireEvent.pointerDown(grip, { button: 0, ...at(30, 560) });
    fireEvent.pointerMove(grip, at(950, 580));
    expect(onRegionChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(grip, at(950, 580));
    expect(onRegionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ spot: 'bottom-right', top: 536, left: 684, canvasHeight: 600 }),
    );
  });

  it('passes canvas markers to its root', () => {
    const { root } = movablePill({ rootProps: { 'data-totem-control': '' } });
    expect(root.hasAttribute('data-totem-control')).toBe(true);
  });
});
