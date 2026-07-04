/**
 * Shared model/request plumbing between the Playout view and its worker.
 */

import type { OccnModelFile, OcpnModelFile } from '../editors/shared/model-types';
import { isOcpnSilent, ocpnBudgetKey } from './engine/ocpn';
import { isEndActivity, isStartActivity } from './engine/occn';
import type { PlayoutProgress, PlayoutResult } from './engine/types';

export type PlayoutModelSource =
  | { format: 'ocpn'; model: OcpnModelFile }
  | { format: 'occn'; model: OccnModelFile };

/** One user-editable activity limit row. */
export type LimitRow = {
  /** Budget key used by the engine. */
  key: string;
  /** Human-readable label ("τ (t3)" for silent transitions). */
  label: string;
  silent: boolean;
};

export const modelObjectTypes = (
  source: PlayoutModelSource,
): { name: string; color?: string }[] => source.model.objectTypes;

/** The activity-limit rows to show for a model. */
export function limitRowsFor(source: PlayoutModelSource): LimitRow[] {
  if (source.format === 'ocpn') {
    const rows = new Map<string, LimitRow>();
    for (const t of source.model.transitions) {
      const key = ocpnBudgetKey(t);
      if (rows.has(key)) continue;
      rows.set(key, {
        key,
        label: isOcpnSilent(t) ? `τ (${t.id})` : t.label!,
        silent: isOcpnSilent(t),
      });
    }
    return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  const names = new Set<string>([
    ...source.model.activities.map((a) => a.name),
    ...Object.keys(source.model.markerGroups),
  ]);
  return [...names]
    .filter((name) => !isStartActivity(name) && !isEndActivity(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ key: name, label: name, silent: false }));
}

/**
 * The full budget map for the engine. For OCCN the START_/END_ pseudo
 * activities are limited automatically to the number of objects of their
 * type (each object starts once and is expected to end once).
 */
export function buildActivityLimits(
  source: PlayoutModelSource,
  rowLimits: Record<string, number>,
  objectsPerType: Record<string, number>,
): Record<string, number> {
  const limits: Record<string, number> = { ...rowLimits };
  if (source.format === 'occn') {
    for (const ot of source.model.objectTypes) {
      const count = Object.prototype.hasOwnProperty.call(objectsPerType, ot.name)
        ? objectsPerType[ot.name]
        : 0;
      limits[`START_${ot.name}`] = count;
      limits[`END_${ot.name}`] = count;
    }
  }
  return limits;
}

export type PlayoutRequest = {
  source: PlayoutModelSource;
  objectsPerType: Record<string, number>;
  /** Complete budget map (per activity/τ key, incl. auto START/END). */
  activityLimits: Record<string, number>;
  timeoutMs: number;
  maxStoredVariants: number;
  maxStates: number;
};

export type PlayoutWorkerMessage =
  | { type: 'progress'; progress: PlayoutProgress }
  | { type: 'done'; result: PlayoutResult }
  | { type: 'error'; message: string };
