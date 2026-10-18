import { useEffect, useMemo, useState } from 'react';
import { prepareGridLayout, type GridEdge, type GridLayer, type LayoutInfo } from './gridLayout';

type GridLayoutInput = { layers: GridLayer[]; edges: GridEdge[] };

const EMPTY_LAYOUT = prepareGridLayout([], []);

/**
 * `prepareGridLayout(input.layers, input.edges)` in a Web Worker.
 *
 * The layout search can take minutes for a log with many object types; run
 * during render it froze the whole page (Cancel buttons included). Here it
 * runs in a worker with the same result.
 *
 * Returns the last input whose layout is done (`shown`, null before the
 * first) together with that layout, so what is drawn always matches its
 * layout; `pending` is true while a newer input is being laid out. A newer
 * input, or unmounting, stops a running search by terminating its worker.
 *
 * Computed on the main thread, as before, where there are no workers
 * (tests), for an empty hierarchy, and after a worker failed.
 */
export function useGridLayout<T extends GridLayoutInput>(input: T) {
  const [mainThread, setMainThread] = useState(() => typeof Worker === 'undefined');
  const [done, setDone] = useState<{ input: T; layout: LayoutInfo } | null>(null);

  const syncLayout = useMemo(
    () => (mainThread || input.layers.length === 0 ? prepareGridLayout(input.layers, input.edges) : null),
    [mainThread, input],
  );

  useEffect(() => {
    if (syncLayout) {
      // Shown directly; an older worker result must not come back later.
      setDone(null);
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./gridLayout.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      console.warn('Process-area layout worker could not be started; laying out on the main thread', err);
      setMainThread(true);
      return;
    }
    let superseded = false;
    worker.onmessage = (event: MessageEvent<LayoutInfo>) => {
      worker.terminate();
      if (!superseded) setDone({ input, layout: event.data });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      if (superseded) return;
      console.warn('Process-area layout worker failed; laying out on the main thread', event);
      setMainThread(true);
    };
    worker.postMessage({ layers: input.layers, edges: input.edges });
    return () => {
      superseded = true;
      worker.terminate();
    };
  }, [input, syncLayout]);

  if (syncLayout) return { shown: input, layout: syncLayout, pending: false };
  return {
    shown: done?.input ?? null,
    layout: done?.layout ?? EMPTY_LAYOUT,
    pending: done?.input !== input,
  };
}
