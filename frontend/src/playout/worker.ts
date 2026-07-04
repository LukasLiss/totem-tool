/**
 * Web worker running the wide playout off the main thread. The view
 * terminates the worker to cancel a run, so no cancel message is needed.
 */

import { createOccnEngine } from './engine/occn';
import { createOcpnEngine } from './engine/ocpn';
import { runPlayout } from './engine/search';
import type { PlayoutRequest, PlayoutWorkerMessage } from './model';

const post = (message: PlayoutWorkerMessage) => self.postMessage(message);

self.onmessage = (e: MessageEvent<PlayoutRequest>) => {
  const request = e.data;
  try {
    const engine =
      request.source.format === 'ocpn'
        ? createOcpnEngine(request.source.model, request.objectsPerType)
        : createOccnEngine(
            {
              objectTypes: request.source.model.objectTypes.map((t) => t.name),
              activities: request.source.model.activities.map((a) => a.name),
              markerGroups: request.source.model.markerGroups,
            },
            request.objectsPerType,
          );
    const result = runPlayout(engine, {
      mode: 'variants',
      objectsPerType: request.objectsPerType,
      activityLimits: request.activityLimits,
      defaultActivityLimit: 1,
      timeoutMs: request.timeoutMs,
      maxStoredVariants: request.maxStoredVariants,
      maxStates: request.maxStates,
      onProgress: (progress) => post({ type: 'progress', progress }),
    });
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
