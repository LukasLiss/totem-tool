import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';

/**
 * ELK layouts in Web Workers.
 *
 * `elk.bundled.js` on its own runs every layout on the main thread, so laying
 * out a large graph (an OC-DFG of a diverse log has thousands of arcs) freezes
 * the whole page — clicks, Cancel buttons and progress polling included —
 * until it is done. `elkLayout` runs the same ELK build in a worker instead;
 * the graph goes in and the laid-out graph comes back exactly as before.
 *
 * At most `MAX_WORKERS` layouts run at once (one huge graph does not hold up
 * every other layout); further calls wait for a free worker. Aborting `signal`
 * drops a waiting layout or shuts down the worker of a running one — the only
 * way to stop ELK mid-layout.
 *
 * Where workers are unavailable (vitest, or the worker script cannot be
 * loaded) layouts run on the main thread as before.
 */

type ElkInstance = InstanceType<typeof ELK>;
type WorkerElk = { elk: ElkInstance; worker: Worker };

const MAX_WORKERS = 2;
const idleWorkers: WorkerElk[] = [];
const waiting: Array<() => void> = [];
let busyWorkers = 0;
let workersUnavailable = typeof Worker === 'undefined';
// Set once any worker answered: from then on a worker error is a failed
// layout (e.g. out of memory), not a worker script that cannot load here.
let workerAnswered = false;
let inThreadElk: ElkInstance | null = null;

const abortError = () => new DOMException('Layout cancelled', 'AbortError');

// Without a worker a layout blocks the page until it is done: for a large
// graph that freezes the page for minutes, cannot be cancelled and can crash
// it. Such layouts are refused there (and fail visibly); small ones still run.
const MAX_IN_THREAD_EDGES = 500;

function inThreadLayout(graph: ElkNode): Promise<ElkNode> {
  const edgeCount = graph.edges?.length ?? 0;
  if (edgeCount > MAX_IN_THREAD_EDGES) {
    return Promise.reject(
      new Error(`No ELK worker available; not laying out ${edgeCount} edges on the main thread`),
    );
  }
  inThreadElk ??= new ELK();
  return inThreadElk.layout(graph);
}

function startWorker(): WorkerElk {
  const worker = new Worker(elkWorkerUrl);
  worker.addEventListener('message', () => { workerAnswered = true; });
  return { elk: new ELK({ workerFactory: () => worker }), worker };
}

/** Wait for a free worker slot; rejects if `signal` aborts meanwhile. */
function acquireSlot(signal?: AbortSignal): Promise<void> {
  if (busyWorkers < MAX_WORKERS) {
    busyWorkers += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const index = waiting.indexOf(grant);
      if (index >= 0) waiting.splice(index, 1);
      reject(abortError());
    };
    const grant = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    waiting.push(grant);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function releaseSlot() {
  const next = waiting.shift();
  // The slot passes straight to the next waiting layout.
  if (next) next();
  else busyWorkers -= 1;
}

export async function elkLayout(graph: ElkNode, signal?: AbortSignal): Promise<ElkNode> {
  if (signal?.aborted) throw abortError();
  if (workersUnavailable) return inThreadLayout(graph);

  await acquireSlot(signal);
  // Aborted while the slot was being handed over: the abort event has fired
  // already, so the listener below would never hear of it.
  if (signal?.aborted) {
    releaseSlot();
    throw abortError();
  }
  let slot: WorkerElk;
  try {
    slot = idleWorkers.pop() ?? startWorker();
  } catch (err) {
    releaseSlot();
    workersUnavailable = true;
    console.warn('ELK worker could not be started; layouts run on the main thread', err);
    return inThreadLayout(graph);
  }

  return new Promise<ElkNode>((resolve, reject) => {
    let settled = false;
    const settle = (keepWorker: boolean) => {
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      slot.worker.removeEventListener('error', onError);
      if (keepWorker) idleWorkers.push(slot);
      else slot.elk.terminateWorker();
      releaseSlot();
    };
    const onAbort = () => {
      if (settled) return;
      settle(false);
      reject(abortError());
    };
    // ELK itself never settles the layout when its worker dies.
    const onError = (event: Event) => {
      if (settled) return;
      settle(false);
      if (!workerAnswered) {
        workersUnavailable = true;
        console.warn('ELK worker could not be loaded; layouts run on the main thread', event);
        inThreadLayout(graph).then(resolve, reject);
        return;
      }
      reject(new Error(`ELK worker failed: ${(event as ErrorEvent).message ?? 'unknown error'}`));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    slot.worker.addEventListener('error', onError);

    slot.elk.layout(graph).then(
      (result) => {
        if (settled) return;
        settle(true);
        resolve(result);
      },
      (err) => {
        if (settled) return;
        // A worker whose layout threw is not reused.
        settle(false);
        reject(err);
      },
    );
  });
}

export function isLayoutAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
