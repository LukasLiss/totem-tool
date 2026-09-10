/**
 * Model/request plumbing and result types of the Playout view. The playout
 * itself runs on the backend (POST /api/playout/); this module only keeps
 * the small pure helpers the UI needs plus the request/response types.
 */

import type { OccnModelFile, OcpnModelFile } from '../editors/shared/model-types';

export type PlayoutModelSource =
  | { format: 'ocpn'; model: OcpnModelFile }
  | { format: 'occn'; model: OccnModelFile };

// ---------------------------------------------------------------------------
// Small local helpers (mirror the backend engine's key/visibility rules)
// ---------------------------------------------------------------------------

/** True for silent (τ) transitions: silent flag set or no/empty label. */
const isOcpnSilent = (transition: { label?: string | null; silent?: boolean }): boolean =>
  transition.silent === true ||
  transition.label === null ||
  transition.label === undefined ||
  transition.label === '';

/** Budget key of a transition: its label, or "τ:<id>" when silent. */
const ocpnBudgetKey = (transition: { id: string; label?: string | null; silent?: boolean }): string =>
  isOcpnSilent(transition) ? `τ:${transition.id}` : transition.label!;

const isStartActivity = (act: string) => act.startsWith('START_');
const isEndActivity = (act: string) => act.startsWith('END_');

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
 * Bulk-adjust activity limits: add `delta` to the limit of every key in
 * `keys` (missing keys count as 0), clamped to [min, max]. Pure — returns a
 * new map, keys outside `keys` are kept untouched.
 */
export function bumpAllLimits(
  limits: Record<string, number>,
  keys: readonly string[],
  delta: number,
  min: number,
  max: number,
): Record<string, number> {
  const next: Record<string, number> = { ...limits };
  for (const key of keys) {
    next[key] = Math.min(max, Math.max(min, (next[key] ?? 0) + delta));
  }
  return next;
}

// ---------------------------------------------------------------------------
// Backend request/response types (shape of POST /api/playout/)
// ---------------------------------------------------------------------------

export type PlayoutRequest = {
  modelFormat: 'ocpn' | 'occn';
  /** The editor model file JSON (OcpnModelFile or OccnModelFile). */
  model: OcpnModelFile | OccnModelFile;
  objectsPerType: Record<string, number>;
  /**
   * User-set budgets per limit row; the server completes them (OCCN
   * START_/END_ pseudo activities) into the effective budget map.
   */
  activityLimits: Record<string, number>;
  timeoutS: number;
  maxStoredVariants: number;
  maxStates: number;
};

/** One event of a process execution: an activity plus the bound objects. */
export type PlayoutEvent = {
  activity: string;
  /** Silent transitions and START_/END_ pseudo activities are invisible. */
  visible: boolean;
  /** Object ids per object type, sorted. */
  objects: Record<string, string[]>;
};

/** One object-centric variant (a canonical complete process execution). */
export type PlayoutVariant = {
  /** Visible events in canonical order with canonical object names. */
  events: PlayoutEvent[];
  /** Number of objects per type participating in visible events. */
  objectCounts: Record<string, number>;
};

export type PlayoutResult = {
  variants: PlayoutVariant[];
  /** Total distinct variants found (>= variants.length). */
  variantCount: number;
  /** Complete executions reached (canonical ones counted). */
  completedRuns: number;
  statesExplored: number;
  elapsedMs: number;
  /** True if the search space was fully explored within all limits. */
  exhaustive: boolean;
  timedOut: boolean;
  /** True if the state-cap was hit before the search finished. */
  stateCapHit: boolean;
  /**
   * True if variant dedup had to skip the full canonical minimization for
   * at least one execution (too many symmetric objects). The variant count
   * is then an upper bound of the true count (never an undercount).
   */
  approximateDedup: boolean;
  warnings: string[];
  /** Complete budget map the server used (incl. auto START_/END_ limits). */
  effectiveActivityLimits: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Variants JSON download (pure client-side packaging)
// ---------------------------------------------------------------------------

/** Self-describing variants file (one entry per object-centric variant). */
export function variantsToJson(
  variants: readonly PlayoutVariant[],
  meta: {
    modelName: string;
    modelFormat: 'ocpn' | 'occn';
    objectsPerType: Record<string, number>;
    /** The result's effectiveActivityLimits. */
    activityLimits: Record<string, number>;
    variantCount: number;
    exhaustive: boolean;
  },
) {
  return {
    format: 'oc-playout-variants',
    version: 1,
    model: { name: meta.modelName, format: meta.modelFormat },
    parameters: {
      objectsPerType: meta.objectsPerType,
      activityLimits: meta.activityLimits,
    },
    totalVariantCount: meta.variantCount,
    countIsExact: meta.exhaustive,
    variants: variants.map((variant) => ({
      objectCounts: variant.objectCounts,
      events: variant.events.map((event) => ({
        activity: event.activity,
        objects: event.objects,
      })),
    })),
  };
}
