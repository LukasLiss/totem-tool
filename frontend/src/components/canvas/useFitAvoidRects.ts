/**
 * The canvas controls a graph's fit keeps clear of (see canvasFit), measured:
 * every element marked `data-fit-avoid` inside the canvas (the closest
 * ancestor of the graph marked `data-canvas-shell`, the graph's box itself if
 * it is marked so). The mark says how the fit treats it:
 *  - "header": part of the header row (the title, top-right chips): the
 *    graph starts below it, never beside it;
 *  - "corner": the collapsed legend chip under the title: the graph starts
 *    below it, or beside it where it is not pushed aside for that;
 *  - "box": a small control the graph may sit beside;
 *  - "optional": an open panel, which only gets room while that leaves the
 *    graph at least half its size.
 * In px from the graph box's top-left corner, kept current as they resize.
 * The control pill is not marked: canvases add pillRect(region) themselves.
 */
import { useEffect, useState, type DependencyList, type RefObject } from 'react';
import type { FitRect } from './canvasFit';

export function useFitAvoidRects(host: RefObject<HTMLElement | null>, deps: DependencyList): FitRect[] {
  const [rects, setRects] = useState<FitRect[]>([]);
  useEffect(() => {
    const el = host.current;
    const shell = el?.closest<HTMLElement>('[data-canvas-shell]');
    if (!el || !shell || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const origin = el.getBoundingClientRect();
      const next: FitRect[] = [];
      shell.querySelectorAll<HTMLElement>('[data-fit-avoid]').forEach((control) => {
        const r = control.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const kind = control.dataset.fitAvoid;
        next.push({
          x: r.left - origin.left,
          y: r.top - origin.top,
          w: r.width,
          h: r.height,
          ...(kind === 'header'
            ? { header: true }
            : kind === 'corner'
              ? { corner: true }
              : kind === 'optional'
                ? { optional: true }
                : {}),
        });
      });
      setRects((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    shell.querySelectorAll('[data-fit-avoid]').forEach((control) => observer.observe(control));
    return () => observer.disconnect();
    // The caller names what adds, removes or re-marks controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return rects;
}
