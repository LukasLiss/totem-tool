import { describe, expect, it } from 'vitest';
import {
  MOUSE_ZOOM_STEP,
  WHEEL_GESTURE_GAP_MS,
  guessWheelDevice,
  newWheelStream,
  wheelIntent,
  type WheelLike,
} from '../canvasGestures';

const wheel = (e: Partial<WheelLike>): WheelLike => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...e,
});
/** One event on its own (a fresh gesture). */
const intent = (e: Partial<WheelLike>) => wheelIntent(wheel(e), newWheelStream(), 0);

describe('guessWheelDevice', () => {
  it('tells a mouse wheel from a trackpad', () => {
    // Firefox: lines.
    expect(guessWheelDevice(wheel({ deltaY: 3, deltaMode: 1 }))).toBe('mouse');
    // Sideways: two fingers.
    expect(guessWheelDevice(wheel({ deltaX: 4, deltaY: 1 }))).toBe('trackpad');
    // Chrome/Safari: trackpads report wheelDeltaY = −3 × deltaY, a notch ±120.
    expect(guessWheelDevice(wheel({ deltaY: 7, wheelDeltaY: -21 }))).toBe('trackpad');
    expect(guessWheelDevice(wheel({ deltaY: 100, wheelDeltaY: -120 }))).toBe('mouse');
    // Without it: fractional or small steps a trackpad, whole notches a mouse.
    expect(guessWheelDevice(wheel({ deltaY: 2.5 }))).toBe('trackpad');
    expect(guessWheelDevice(wheel({ deltaY: 6 }))).toBe('trackpad');
    expect(guessWheelDevice(wheel({ deltaY: 100 }))).toBe('mouse');
  });
});

describe('wheelIntent', () => {
  it('moves the content with two fingers, in every direction', () => {
    // The content follows the fingers: a scroll down/right moves it up/left.
    expect(intent({ deltaX: 3, deltaY: -2 })).toEqual({ kind: 'pan', dx: -3, dy: 2 });
  });

  it('zooms with a pinch (Ctrl + wheel from the browser), smoothly', () => {
    const zoomIn = intent({ deltaY: -10, ctrlKey: true, wheelDeltaY: 30 });
    expect(zoomIn.kind).toBe('zoom');
    expect(zoomIn.kind === 'zoom' && zoomIn.scale).toBeCloseTo(Math.exp(0.1), 6);
    const zoomOut = intent({ deltaY: 4.5, ctrlKey: true });
    expect(zoomOut.kind === 'zoom' && zoomOut.scale).toBeLessThan(1);
  });

  it('zooms in steps with the mouse wheel (with or without Ctrl/Cmd)', () => {
    expect(intent({ deltaY: 100 })).toEqual({ kind: 'zoom', scale: 1 / MOUSE_ZOOM_STEP });
    expect(intent({ deltaY: -100 })).toEqual({ kind: 'zoom', scale: MOUSE_ZOOM_STEP });
    expect(intent({ deltaY: -100, metaKey: true })).toEqual({ kind: 'zoom', scale: MOUSE_ZOOM_STEP });
  });

  it('moves sideways with Shift + mouse wheel', () => {
    expect(intent({ deltaY: 100, shiftKey: true })).toEqual({ kind: 'pan', dx: -100, dy: 0 });
    // Line steps in pixels.
    expect(intent({ deltaY: 3, deltaMode: 1, shiftKey: true })).toEqual({ kind: 'pan', dx: -48, dy: 0 });
  });

  it('keeps the device for one gesture, a new one is guessed again', () => {
    const stream = newWheelStream();
    // A trackpad gesture …
    expect(wheelIntent(wheel({ deltaX: 2, deltaY: 1 }), stream, 0).kind).toBe('pan');
    // … whose fast swipe looks like a notch on its own: still moving, not zooming.
    expect(wheelIntent(wheel({ deltaY: 60 }), stream, 50).kind).toBe('pan');
    // After a pause the same event starts a new gesture: a mouse notch.
    expect(wheelIntent(wheel({ deltaY: 60 }), stream, 50 + WHEEL_GESTURE_GAP_MS + 1).kind).toBe('zoom');
  });
});
