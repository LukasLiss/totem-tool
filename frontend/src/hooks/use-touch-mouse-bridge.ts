import { useEffect, type RefObject } from "react";

/**
 * Touches that start on these keep their native behaviour (sliders, form
 * fields, scrolling overlay panels). Buttons are deliberately not listed:
 * graph nodes are often buttons, and a drag that starts on one must pan just
 * as it does with the mouse. A tap on a button never becomes a drag, so it
 * still clicks.
 */
const NATIVE_TOUCH_SELECTOR =
  'input, select, textarea, [role="slider"], [data-totem-control], [data-touch-native]';

/** Finger travel, in px, before a touch counts as a drag rather than a tap. */
const DRAG_THRESHOLD = 6;
/** Pinch distance ratio that produces one wheel step. */
const PINCH_STEP = 1.08;

/**
 * Lets a canvas written for the mouse be panned and zoomed with fingers.
 *
 * Several visualizers implement pan and zoom with mousedown/mousemove/mouseup
 * and wheel listeners. A phone only synthesizes mouse events for taps, never
 * for drags, so those canvases cannot be moved at all. This bridge replays a
 * one-finger drag as a mouse drag and a two-finger pinch as wheel steps at the
 * pinch centre, which the existing handlers already understand.
 *
 * Only active while `enabled`: a locked canvas must leave the touch alone so
 * the page underneath can still be scrolled.
 */
export function useTouchMouseBridge(
  ref: RefObject<HTMLElement | SVGElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    type Mode = "idle" | "pending" | "drag" | "pinch";
    let mode: Mode = "idle";
    let target: EventTarget | null = null;
    let start = { x: 0, y: 0 };
    let last = { x: 0, y: 0 };
    let pinchDistance = 0;

    const mouse = (type: string, x: number, y: number) => {
      (target ?? el).dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === "mouseup" ? 0 : 1,
        }),
      );
    };

    const distance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
      );

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        if (mode === "idle" && (e.target as Element | null)?.closest?.(NATIVE_TOUCH_SELECTOR)) return;
        if (mode === "drag") mouse("mouseup", last.x, last.y);
        mode = "pinch";
        pinchDistance = distance(e.touches);
        e.preventDefault();
        return;
      }
      if (e.touches.length !== 1) return;
      if ((e.target as Element | null)?.closest?.(NATIVE_TOUCH_SELECTOR)) {
        mode = "idle";
        return;
      }
      const touch = e.touches[0];
      mode = "pending";
      target = e.target;
      start = { x: touch.clientX, y: touch.clientY };
      last = start;
    };

    const onMove = (e: TouchEvent) => {
      if (mode === "idle") return;
      // The canvas owns the gesture; without this the page scrolls instead.
      if (e.cancelable) e.preventDefault();

      if (mode === "pinch") {
        if (e.touches.length < 2) return;
        const next = distance(e.touches);
        if (pinchDistance <= 0) {
          pinchDistance = next;
          return;
        }
        const clientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const clientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const wheel = (deltaY: number) =>
          el.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX, clientY, deltaY }),
          );
        while (next / pinchDistance >= PINCH_STEP) {
          wheel(-100);
          pinchDistance *= PINCH_STEP;
        }
        while (pinchDistance / next >= PINCH_STEP) {
          wheel(100);
          pinchDistance /= PINCH_STEP;
        }
        return;
      }

      const touch = e.touches[0];
      if (!touch) return;
      const point = { x: touch.clientX, y: touch.clientY };
      if (mode === "pending") {
        if (Math.hypot(point.x - start.x, point.y - start.y) < DRAG_THRESHOLD) return;
        mode = "drag";
        mouse("mousedown", start.x, start.y);
      }
      last = point;
      mouse("mousemove", point.x, point.y);
    };

    const onEnd = (e: TouchEvent) => {
      if (mode === "drag") {
        mouse("mouseup", last.x, last.y);
        // The drag is over; keep the browser from adding its own click.
        if (e.cancelable) e.preventDefault();
        mode = "idle";
      } else if (mode === "pinch") {
        if (e.cancelable) e.preventDefault();
        if (e.touches.length === 0) mode = "idle";
      } else {
        // A plain tap: the browser's own mouse emulation delivers the click.
        mode = "idle";
      }
    };

    const options: AddEventListenerOptions = { passive: false };
    el.addEventListener("touchstart", onStart as EventListener, options);
    el.addEventListener("touchmove", onMove as EventListener, options);
    el.addEventListener("touchend", onEnd as EventListener, options);
    el.addEventListener("touchcancel", onEnd as EventListener, options);
    return () => {
      el.removeEventListener("touchstart", onStart as EventListener);
      el.removeEventListener("touchmove", onMove as EventListener);
      el.removeEventListener("touchend", onEnd as EventListener);
      el.removeEventListener("touchcancel", onEnd as EventListener);
    };
  }, [ref, enabled]);
}
