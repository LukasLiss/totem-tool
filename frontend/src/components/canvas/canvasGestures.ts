/**
 * What a wheel event means on a graph canvas, trackpad and mouse alike:
 *  - two fingers on a trackpad move the graph in every direction,
 *  - a pinch (Ctrl/Cmd + wheel in the browser) zooms at the pointer,
 *  - a mouse wheel zooms in steps (as before), Shift + wheel moves sideways,
 *  - Ctrl/Cmd + mouse wheel zooms too.
 *
 * Browsers send trackpads and mice through the same wheel event, so the
 * device is guessed from the event (line steps, sideways movement, step
 * size, Chrome's legacy `wheelDeltaY`) and kept for one gesture, so a
 * gesture never switches between moving and zooming halfway.
 * Pure, without the DOM, so it can be tested and shared by every canvas.
 */

export type WheelDevice = 'mouse' | 'trackpad';

/** Move the content by dx/dy screen px (it follows the fingers), or zoom by `scale` (> 1: in). */
export type WheelIntent = { kind: 'pan'; dx: number; dy: number } | { kind: 'zoom'; scale: number };

/** The parts of a WheelEvent the decision needs. */
export interface WheelLike {
  deltaX: number;
  deltaY: number;
  /** 0: pixels, 1: lines, 2: pages. */
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** Chrome/Safari's legacy value: −3 × deltaY for trackpads. */
  wheelDeltaY?: number;
}

/** The device of the gesture going on: kept while its events follow each other closely. */
export interface WheelStream {
  at: number;
  device: WheelDevice | null;
}

/** Events closer than this belong to one gesture. */
export const WHEEL_GESTURE_GAP_MS = 200;
/** One mouse wheel notch zooms by this factor (as before). */
export const MOUSE_ZOOM_STEP = 1.12;
/** How fast a pinch zooms: the scale per pixel of wheel delta. */
const PINCH_ZOOM_SPEED = 0.01;
const LINE_PX = 16;
const PAGE_PX = 400;

export const newWheelStream = (): WheelStream => ({ at: -Infinity, device: null });

/** The device a single event looks like. */
export function guessWheelDevice(e: WheelLike): WheelDevice {
  // Lines or pages: a mouse wheel (Firefox).
  if (e.deltaMode !== 0) return 'mouse';
  // Sideways movement comes from two fingers.
  if (e.deltaX !== 0) return 'trackpad';
  // Chrome and Safari report trackpad events with wheelDeltaY = −3 × deltaY.
  if (e.wheelDeltaY != null && e.wheelDeltaY !== 0) return e.wheelDeltaY === -3 * e.deltaY ? 'trackpad' : 'mouse';
  // Fractional or small steps: a trackpad; whole steps of 50 px and more: a wheel notch.
  if (!Number.isInteger(e.deltaY)) return 'trackpad';
  return Math.abs(e.deltaY) >= 50 ? 'mouse' : 'trackpad';
}

/** The device of the gesture `e` belongs to (`stream` keeps it for the gesture). */
export function wheelDevice(e: WheelLike, stream: WheelStream, now: number): WheelDevice {
  const device = stream.device != null && now - stream.at < WHEEL_GESTURE_GAP_MS ? stream.device : guessWheelDevice(e);
  stream.device = device;
  stream.at = now;
  return device;
}

/** What the wheel event `e` asks the canvas to do. */
export function wheelIntent(e: WheelLike, stream: WheelStream, now: number): WheelIntent {
  const device = wheelDevice(e, stream, now);
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;
  if (e.ctrlKey || e.metaKey) {
    // A pinch (the browser sends it as Ctrl + wheel), or Ctrl/Cmd + a wheel notch.
    return { kind: 'zoom', scale: device === 'mouse' ? notch(dy) : Math.exp(-dy * PINCH_ZOOM_SPEED) };
  }
  if (device === 'trackpad') return { kind: 'pan', dx: -dx, dy: -dy };
  // A mouse wheel: Shift moves sideways, otherwise it zooms (as before).
  if (e.shiftKey) return { kind: 'pan', dx: -(dx || dy), dy: 0 };
  return { kind: 'zoom', scale: notch(dy) };
}

const notch = (dy: number) => (dy > 0 ? 1 / MOUSE_ZOOM_STEP : dy < 0 ? MOUSE_ZOOM_STEP : 1);
