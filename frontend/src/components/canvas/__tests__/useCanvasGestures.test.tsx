// @vitest-environment happy-dom

import { useRef } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCanvasGestures, type CanvasGestureHandlers } from '../useCanvasGestures';

function Canvas({ enabled = true, handlers }: { enabled?: boolean; handlers: CanvasGestureHandlers }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useCanvasGestures(ref, enabled, handlers);
  return <div ref={ref} data-testid="canvas" />;
}

const setup = (enabled = true) => {
  const handlers = { onPan: vi.fn(), onZoom: vi.fn(), onMultiTouchStart: vi.fn() };
  const utils = render(<Canvas enabled={enabled} handlers={handlers} />);
  return { ...handlers, canvas: utils.getByTestId('canvas') };
};

afterEach(() => cleanup());

describe('useCanvasGestures', () => {
  it('moves on two-finger scrolling, without scrolling the page', () => {
    const { canvas, onPan } = setup();
    const scroll = new WheelEvent('wheel', { deltaX: 5, deltaY: 3, cancelable: true });
    canvas.dispatchEvent(scroll);
    expect(onPan).toHaveBeenCalledWith(-5, -3);
    expect(scroll.defaultPrevented).toBe(true);
  });

  it('zooms at the pointer on a mouse wheel notch', () => {
    const { canvas, onZoom, onPan } = setup();
    const notch = new WheelEvent('wheel', { cancelable: true });
    // The fields as a browser sends them for a notch (happy-dom leaves some unset).
    Object.defineProperties(notch, {
      clientX: { value: 40 },
      clientY: { value: 30 },
      deltaX: { value: 0 },
      deltaY: { value: -100 },
      deltaMode: { value: 0 },
      wheelDeltaY: { value: 120 },
    });
    canvas.dispatchEvent(notch);
    expect(onZoom).toHaveBeenCalledWith(1.12, 40, 30);
    expect(onPan).not.toHaveBeenCalled();
  });

  it('zooms on Safari’s pinch by the change of its scale', () => {
    const { canvas, onZoom } = setup();
    const gesture = (type: string, scale: number) =>
      Object.assign(new Event(type, { cancelable: true }), { scale, clientX: 10, clientY: 20 });
    canvas.dispatchEvent(gesture('gesturestart', 1));
    canvas.dispatchEvent(gesture('gesturechange', 1.5));
    canvas.dispatchEvent(gesture('gesturechange', 3));
    expect(onZoom.mock.calls).toEqual([
      [1.5, 10, 20],
      [2, 10, 20],
    ]);
  });

  it('moves and zooms with two fingers on a touch screen', () => {
    const { canvas, onPan, onZoom, onMultiTouchStart } = setup();
    const touch = (type: string, pointerId: number, x: number, y: number) =>
      fireEvent(canvas, new PointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
    touch('pointerdown', 1, 0, 0);
    expect(onMultiTouchStart).not.toHaveBeenCalled();
    touch('pointerdown', 2, 100, 0);
    expect(onMultiTouchStart).toHaveBeenCalledTimes(1);
    // The second finger moves 100 px further right: the middle moves 50 px, the distance doubles.
    touch('pointermove', 2, 200, 0);
    expect(onPan).toHaveBeenCalledWith(50, 0);
    expect(onZoom).toHaveBeenCalledWith(2, 100, 0);
    // One finger lifted: nothing more from here (the canvas' own drag takes over).
    touch('pointerup', 2, 200, 0);
    touch('pointermove', 1, 30, 0);
    expect(onPan).toHaveBeenCalledTimes(1);
  });

  it('does nothing while switched off (e.g. a locked canvas): the page scrolls', () => {
    const { canvas, onPan, onZoom } = setup(false);
    const scroll = new WheelEvent('wheel', { deltaX: 5, deltaY: 3, cancelable: true });
    canvas.dispatchEvent(scroll);
    expect(onPan).not.toHaveBeenCalled();
    expect(onZoom).not.toHaveBeenCalled();
    expect(scroll.defaultPrevented).toBe(false);
  });
});
