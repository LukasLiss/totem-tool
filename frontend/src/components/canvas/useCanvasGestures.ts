/**
 * Trackpad, pinch and touch gestures for a graph canvas, for any canvas that
 * can move and zoom its content (see canvasGestures for what each gesture
 * means). The canvas keeps its own one-pointer drag (grab and move); this
 * adds:
 *  - the wheel: two fingers move, a pinch or the mouse wheel zooms,
 *  - Safari's pinch, which arrives as gesture events instead of the wheel,
 *  - two fingers on a touch screen: move and pinch together.
 *
 * The canvas gets screen-space requests only: move the content by dx/dy px,
 * zoom by a scale at a point (client coordinates).
 */
import { useEffect, useRef, type RefObject } from 'react';
import { newWheelStream, wheelIntent } from './canvasGestures';

export interface CanvasGestureHandlers {
  /** Move the content by dx/dy screen px (it follows the fingers). */
  onPan: (dx: number, dy: number) => void;
  /** Zoom by `scale` (> 1: in) around the point at clientX/clientY. */
  onZoom: (scale: number, clientX: number, clientY: number) => void;
  /** A second finger touched down: a one-finger drag going on should stop. */
  onMultiTouchStart?: () => void;
}

/** Safari's (non-standard) GestureEvent. */
type GestureLike = Event & { scale: number; clientX: number; clientY: number };

export function useCanvasGestures(
  ref: RefObject<Element | null>,
  enabled: boolean,
  handlers: CanvasGestureHandlers,
) {
  // The latest handlers, without re-attaching the listeners on every render.
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    // --- wheel: trackpad, pinch, mouse wheel ---------------------------------
    const stream = newWheelStream();
    const onWheel = (e: Event) => {
      const w = e as WheelEvent & { wheelDeltaY?: number };
      // Non-passive: the page must neither scroll nor zoom.
      w.preventDefault();
      const intent = wheelIntent(w, stream, w.timeStamp);
      if (intent.kind === 'pan') latest.current.onPan(intent.dx, intent.dy);
      else latest.current.onZoom(intent.scale, w.clientX, w.clientY);
    };

    // --- Safari's pinch --------------------------------------------------------
    let gestureScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = 1;
    };
    const onGestureChange = (e: Event) => {
      const g = e as GestureLike;
      g.preventDefault();
      if (gestureScale > 0 && g.scale > 0) latest.current.onZoom(g.scale / gestureScale, g.clientX, g.clientY);
      gestureScale = g.scale;
    };

    // --- two fingers on a touch screen: move and pinch ------------------------
    const touches = new Map<number, { x: number; y: number }>();
    let pair: { cx: number; cy: number; d: number } | null = null;
    const pairNow = () => {
      const [a, b] = [...touches.values()];
      return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const onPointerDown = (e: Event) => {
      const p = e as PointerEvent;
      if (p.pointerType !== 'touch') return;
      touches.set(p.pointerId, { x: p.clientX, y: p.clientY });
      if (touches.size === 2) {
        pair = pairNow();
        latest.current.onMultiTouchStart?.();
      }
    };
    const onPointerMove = (e: Event) => {
      const p = e as PointerEvent;
      if (!touches.has(p.pointerId)) return;
      touches.set(p.pointerId, { x: p.clientX, y: p.clientY });
      if (touches.size !== 2 || !pair) return;
      const now = pairNow();
      latest.current.onPan(now.cx - pair.cx, now.cy - pair.cy);
      if (pair.d > 0 && now.d > 0) latest.current.onZoom(now.d / pair.d, now.cx, now.cy);
      pair = now;
    };
    const onPointerEnd = (e: Event) => {
      touches.delete((e as PointerEvent).pointerId);
      if (touches.size < 2) pair = null;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    // Capture: before the canvas' own (one-pointer) drag sees the second finger.
    el.addEventListener('pointerdown', onPointerDown, true);
    el.addEventListener('pointermove', onPointerMove, true);
    el.addEventListener('pointerup', onPointerEnd, true);
    el.addEventListener('pointercancel', onPointerEnd, true);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('pointermove', onPointerMove, true);
      el.removeEventListener('pointerup', onPointerEnd, true);
      el.removeEventListener('pointercancel', onPointerEnd, true);
    };
  }, [ref, enabled]);
}

export default useCanvasGestures;
