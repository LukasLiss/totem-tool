/**
 * The rounded control bar ("pill") the graph canvases put over their graph.
 *
 * Two modes:
 *  - Fixed (no `spots`): the original bar of the organizational mining
 *    explorers, bottom right. Their popovers open at a fixed place above it,
 *    so it stays put there.
 *  - Movable (`spots` given): the same frosted-glass bar with a grip. Dragging
 *    the grip moves the bar with the cursor; on the way it already takes the
 *    shape of the allowed spot nearest to the cursor — horizontal in the
 *    corners, vertical in the middle of the left or right edge, with the grip
 *    at the right end in the right corners — and on release it glides into
 *    that spot. Clicking the grip collapses the bar to just the grip. Spot and
 *    collapsed state are kept per viewer in the browser under `storageKey`.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GripHorizontal, GripVertical } from 'lucide-react';
import { GLASS_SURFACE } from '@/react_component/orgamining/canvasSurface';
import {
  PILL_MARGIN,
  gripAtEnd,
  isVerticalSpot,
  nearestSpot,
  pillRegion,
  type PillRegion,
  type PillSpot,
} from './pillSpots';

export type { PillRegion, PillSpot } from './pillSpots';

/** Distance of the pill from the canvas edges. */
const MARGIN = PILL_MARGIN;
/** Pointer travel (px) before a press on the grip counts as a drag instead of a click. */
const DRAG_THRESHOLD = 4;
const GLIDE = 'transform 180ms ease-out';

const PILL_SURFACE: React.CSSProperties = {
  ...GLASS_SURFACE,
  border: '1px solid #E2E8F0',
  borderRadius: 9999,
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.14)',
};

type PillState = { spot: PillSpot; collapsed: boolean };

function loadState(storageKey: string | undefined, spots: readonly PillSpot[], fallback: PillState): PillState {
  if (!storageKey) return fallback;
  try {
    const raw = localStorage.getItem(`controlPill:${storageKey}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      spot: spots.includes(parsed?.spot) ? parsed.spot : fallback.spot,
      collapsed: typeof parsed?.collapsed === 'boolean' ? parsed.collapsed : fallback.collapsed,
    };
  } catch {
    return fallback;
  }
}

function saveState(storageKey: string | undefined, state: PillState) {
  if (!storageKey) return;
  try {
    localStorage.setItem(`controlPill:${storageKey}`, JSON.stringify(state));
  } catch {
    /* not remembered */
  }
}

function spotPosition(spot: PillSpot, insetTop: number): React.CSSProperties {
  const top = MARGIN + insetTop;
  switch (spot) {
    case 'top-left':
      return { top, left: MARGIN };
    case 'top-right':
      return { top, right: MARGIN };
    case 'bottom-left':
      return { bottom: MARGIN, left: MARGIN };
    case 'bottom-right':
      return { bottom: MARGIN, right: MARGIN };
    case 'left':
      return { top: '50%', left: MARGIN, transform: 'translateY(-50%)' };
    case 'right':
      return { top: '50%', right: MARGIN, transform: 'translateY(-50%)' };
  }
}

/** Keeps a press on the pill from reaching the canvas (pan, selection). */
const stopPointer = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
};

export interface ControlPillProps {
  children: React.ReactNode;
  /** Fixed mode only: overrides of the bar's style (e.g. its position). */
  style?: React.CSSProperties;
  /**
   * Makes the pill movable and collapsible: the spots it may snap to, the
   * free places of this canvas. Leave out spots whose corner holds another
   * panel, and the side spots for pills with sliders or text.
   */
  spots?: readonly PillSpot[];
  /** Where a movable pill starts; the first spot by default. */
  defaultSpot?: PillSpot;
  /** Remembers a movable pill's spot and collapsed state in this browser. */
  storageKey?: string;
  /** Extra room above the top spots, e.g. for a title bar. */
  insetTop?: number;
  zIndex?: number;
  /** Extra attributes for the pill's root, e.g. a canvas' `data-*` marker for its controls. */
  rootProps?: React.HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | boolean | undefined>;
  /**
   * Movable pills: told where the pill sits whenever that changes (after a
   * drop, collapsing, resizing; null once it is gone), so other panels can
   * stay clear of it.
   */
  onRegionChange?: (region: PillRegion | null) => void;
}

export function ControlPill({ spots, ...props }: ControlPillProps) {
  // toArray drops the `false`s conditional controls leave behind, which
  // Children.count would have counted: with no control the bar would render
  // as an empty rounded box that reads as a broken control.
  if (React.Children.toArray(props.children).length === 0) return null;
  return spots && spots.length > 0 ? <MovablePill spots={spots} {...props} /> : <FixedPill {...props} />;
}

/** The original pill of the organizational mining explorers: fixed bottom right. */
function FixedPill({ children, style, zIndex = 16, rootProps }: ControlPillProps) {
  return (
    <div
      {...rootProps}
      {...stopPointer}
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        // Above the canvas's panels and the widget title, below its popovers,
        // which open from this bar. Without an explicit value the pill paints
        // below anything with a positive z-index, including the title.
        zIndex,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        maxWidth: 'calc(100% - 24px)',
        ...PILL_SURFACE,
        padding: '6px 12px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

type Drag = {
  /** Cursor at the press and now (viewport px). */
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Cursor offset from the grip's centre at the press, kept while dragging. */
  offsetX: number;
  offsetY: number;
  moved: boolean;
};

function MovablePill({
  children,
  spots,
  defaultSpot,
  storageKey,
  insetTop = 0,
  zIndex = 16,
  rootProps,
  onRegionChange,
}: ControlPillProps & { spots: readonly PillSpot[] }) {
  const initialSpot = defaultSpot && spots.includes(defaultSpot) ? defaultSpot : spots[0];
  const [state, setState] = useState<PillState>(() =>
    loadState(storageKey, spots, { spot: initialSpot, collapsed: false }),
  );
  // A spot the component no longer offers falls back to its default.
  const spot = spots.includes(state.spot) ? state.spot : initialSpot;
  const { collapsed } = state;

  // While dragging, the bar takes the shape of the spot it would land in.
  const [dragSpot, setDragSpot] = useState<PillSpot | null>(null);
  const shape = dragSpot ?? spot;
  const vertical = isVerticalSpot(shape);
  const gripLast = !vertical && gripAtEnd(shape);

  const update = useCallback(
    (next: PillState) => {
      setState(next);
      saveState(storageKey, next);
    },
    [storageKey],
  );

  // --- drag & glide -----------------------------------------------------------
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const gripRef = useRef<HTMLButtonElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const dragSpotRef = useRef<PillSpot | null>(null);
  /** Where the bar was when it was let go, to glide from (FLIP). */
  const glideFrom = useRef<DOMRect | null>(null);

  /** Moves the bar so its grip sits under the cursor, whatever its current shape. */
  const followCursor = useCallback(() => {
    const d = drag.current;
    const bar = barRef.current;
    const grip = gripRef.current;
    if (!d || !bar || !grip) return;
    bar.style.transition = 'none';
    bar.style.transform = 'none';
    const g = grip.getBoundingClientRect();
    const dx = d.x - d.offsetX - (g.left + g.width / 2);
    const dy = d.y - d.offsetY - (g.top + g.height / 2);
    bar.style.transform = `translate(${dx}px, ${dy}px)`;
  }, []);

  const glide = useCallback(() => {
    const bar = barRef.current;
    const from = glideFrom.current;
    glideFrom.current = null;
    if (!bar) return;
    bar.style.transition = 'none';
    bar.style.transform = 'none';
    if (!from) return;
    const to = bar.getBoundingClientRect();
    bar.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px)`;
    void bar.getBoundingClientRect(); // apply the start before the transition
    bar.style.transition = GLIDE;
    bar.style.transform = 'none';
  }, []);

  // After a re-render: keep following the cursor in the new shape, or glide
  // from where the bar was let go into its spot.
  useLayoutEffect(() => {
    if (drag.current?.moved) followCursor();
    else if (glideFrom.current) glide();
  }, [spot, dragSpot, followCursor, glide]);

  // --- region reporting ---------------------------------------------------------
  // From the spot and the sizes, not the measured box, so a running glide or
  // drag transform does not count; nothing is reported while dragging.
  const onRegionChangeRef = useRef(onRegionChange);
  onRegionChangeRef.current = onRegionChange;
  const lastRegion = useRef('');
  const report = useCallback(() => {
    const notify = onRegionChangeRef.current;
    const bar = barRef.current;
    const canvas = rootRef.current?.offsetParent as HTMLElement | null;
    if (!notify || !bar || !canvas || drag.current?.moved) return;
    const region = pillRegion(
      spot,
      { width: bar.offsetWidth, height: bar.offsetHeight },
      { width: canvas.clientWidth, height: canvas.clientHeight },
      insetTop,
    );
    const key = JSON.stringify(region);
    if (key === lastRegion.current) return;
    lastRegion.current = key;
    notify(region);
  }, [spot, insetTop]);

  useLayoutEffect(() => {
    report();
  }, [report, collapsed, dragSpot]);

  useEffect(() => {
    const bar = barRef.current;
    const canvas = rootRef.current?.offsetParent;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => report());
    observer.observe(bar);
    if (canvas) observer.observe(canvas);
    return () => observer.disconnect();
  }, [report]);

  useEffect(
    () => () => {
      lastRegion.current = '';
      onRegionChangeRef.current?.(null);
    },
    [],
  );

  /** The allowed spot nearest to the cursor, in the canvas' coordinates. */
  const spotUnderCursor = (d: Drag): PillSpot | null => {
    const canvas = rootRef.current?.offsetParent as HTMLElement | null;
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    return nearestSpot({ x: d.x - box.left, y: d.y - box.top }, { width: box.width, height: box.height }, spots);
  };

  const onGripDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = e.currentTarget.getBoundingClientRect();
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - (g.left + g.width / 2),
      offsetY: e.clientY - (g.top + g.height / 2),
      moved: false,
    };
  };

  const onGripMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.moved && Math.hypot(d.x - d.startX, d.y - d.startY) < DRAG_THRESHOLD) return;
    d.moved = true;
    const next = spotUnderCursor(d) ?? spot;
    if (next !== dragSpotRef.current) {
      dragSpotRef.current = next;
      setDragSpot(next); // re-renders in the new shape; the layout effect follows the cursor
    }
    followCursor();
  };

  const endDrag = (land: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      if (land) update({ spot, collapsed: !collapsed });
      return;
    }
    const target = land ? (dragSpotRef.current ?? spot) : spot;
    dragSpotRef.current = null;
    glideFrom.current = barRef.current?.getBoundingClientRect() ?? null;
    setDragSpot(null);
    if (target !== spot) update({ spot: target, collapsed });
    // When neither state changes, no re-render runs the layout effect.
    else if (dragSpot === null) glide();
  };

  const Grip = vertical ? GripHorizontal : GripVertical;
  const gripTitle = collapsed ? 'Drag to move · click to show the controls' : 'Drag to move · click to collapse';

  const grip = (
    <button
      ref={gripRef}
      type="button"
      onPointerDown={onGripDown}
      onPointerMove={onGripMove}
      onPointerUp={() => endDrag(true)}
      onPointerCancel={() => endDrag(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          update({ spot, collapsed: !collapsed });
        }
      }}
      title={gripTitle}
      aria-label={collapsed ? 'Show the controls' : 'Collapse the controls'}
      aria-expanded={!collapsed}
      data-pill-grip={gripLast ? 'end' : 'start'}
      style={{ order: gripLast ? 1 : 0 }}
      className={`flex shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing ${
        collapsed ? 'h-9 w-9' : vertical ? 'h-5 w-9' : 'h-9 w-5'
      }`}
    >
      <Grip className="h-4 w-4" />
    </button>
  );

  return (
    <div
      ref={rootRef}
      {...rootProps}
      {...stopPointer}
      data-pill-spot={spot}
      data-pill-orientation={vertical ? 'vertical' : 'horizontal'}
      data-pill-dragging={dragSpot ? '' : undefined}
      style={{
        position: 'absolute',
        zIndex,
        ...spotPosition(spot, insetTop),
        ...(vertical
          ? { maxHeight: `calc(100% - ${2 * MARGIN}px)` }
          : { maxWidth: `calc(100% - ${2 * MARGIN}px)` }),
      }}
    >
      <div
        ref={barRef}
        style={{
          display: 'flex',
          flexDirection: vertical ? 'column' : 'row',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          justifyContent: shape.endsWith('right') ? 'flex-end' : 'flex-start',
          ...PILL_SURFACE,
          padding: collapsed ? 6 : vertical ? '12px 6px' : '6px 12px',
        }}
      >
        {/* The grip stays the first element and moves to the end with `order`:
            re-mounting it mid-drag would lose the pointer capture. */}
        {grip}
        {!collapsed && children}
      </div>
    </div>
  );
}

export default ControlPill;
