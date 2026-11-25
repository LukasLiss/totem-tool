/**
 * Settings of the object-centric alignment explorer and their persistence
 * as fields of the `OCAlignmentComponent` dashboard widget.
 */
import {
  DEFAULT_OC_ALIGNMENT_MAX_STATES,
  DEFAULT_OC_ALIGNMENT_TIMEOUT_S,
  MAX_OC_ALIGNMENT_MAX_STATES,
  MAX_OC_ALIGNMENT_TIMEOUT_S,
  MIN_OC_ALIGNMENT_MAX_STATES,
  type OCAlignmentSource,
  type OCAlignmentSourceRequest,
} from "@/api/ocAlignmentApi";
import type { ProcessAreaSnapshot } from "@/store/processAreaStore";

export interface OCAlignmentSettings {
  /** The OCPN model asset (de-jure model). */
  assetId: number | null;
  source: OCAlignmentSource;
  executionColumn: string;
  businessObjectTypes: string[];
  businessActivities: string[];
  /** The selected process execution; empty when none is chosen yet. */
  executionId: string;
  maxStates: number;
  timeoutS: number;
  showSilentMoves: boolean;
}

export const DEFAULT_OC_ALIGNMENT_SETTINGS: OCAlignmentSettings = {
  assetId: null,
  source: "area",
  executionColumn: "",
  businessObjectTypes: [],
  businessActivities: [],
  executionId: "",
  maxStates: DEFAULT_OC_ALIGNMENT_MAX_STATES,
  timeoutS: DEFAULT_OC_ALIGNMENT_TIMEOUT_S,
  showSilentMoves: false,
};

/** The persisted widget fields (snake_case, as stored in the layout). */
export interface OCAlignmentNodeFields {
  model_asset: number | null;
  execution_source: OCAlignmentSource;
  execution_column: string;
  business_object_types: string[];
  business_activities: string[];
  execution_id: string;
  max_states: number;
  timeout_s: number;
  show_silent_moves: boolean;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
}

function finite(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function settingsFromNode(node: Partial<Record<keyof OCAlignmentNodeFields, unknown>>): OCAlignmentSettings {
  const asset = Number(node.model_asset);
  return {
    assetId: Number.isInteger(asset) && asset > 0 ? asset : null,
    source: node.execution_source === "stored" ? "stored" : "area",
    executionColumn: typeof node.execution_column === "string" ? node.execution_column : "",
    businessObjectTypes: stringList(node.business_object_types),
    businessActivities: stringList(node.business_activities),
    executionId: typeof node.execution_id === "string" ? node.execution_id : "",
    maxStates: clamp(
      Math.round(finite(node.max_states, DEFAULT_OC_ALIGNMENT_MAX_STATES)),
      MIN_OC_ALIGNMENT_MAX_STATES,
      MAX_OC_ALIGNMENT_MAX_STATES,
    ),
    timeoutS: clamp(finite(node.timeout_s, DEFAULT_OC_ALIGNMENT_TIMEOUT_S), 1, MAX_OC_ALIGNMENT_TIMEOUT_S),
    showSilentMoves: node.show_silent_moves === true,
  };
}

export function settingsToNode(settings: OCAlignmentSettings): OCAlignmentNodeFields {
  return {
    model_asset: settings.assetId,
    execution_source: settings.source,
    execution_column: settings.executionColumn,
    business_object_types: settings.businessObjectTypes,
    business_activities: settings.businessActivities,
    execution_id: settings.executionId,
    max_states: settings.maxStates,
    timeout_s: settings.timeoutS,
    show_silent_moves: settings.showSilentMoves,
  };
}

export function sourceRequest(settings: OCAlignmentSettings): OCAlignmentSourceRequest {
  return settings.source === "stored"
    ? { source: "stored", executionColumn: settings.executionColumn }
    : {
        source: "area",
        businessObjectTypes: settings.businessObjectTypes,
        businessActivities: settings.businessActivities,
      };
}

/** Why the executions cannot be listed yet (null when they can). */
export function sourceBlocker(settings: OCAlignmentSettings): string | null {
  if (settings.source === "stored") {
    return settings.executionColumn ? null : "Choose the column with the stored process executions.";
  }
  return settings.businessObjectTypes.length > 0
    ? null
    : "Choose a process area or at least one business object type.";
}

/** Why the alignment cannot be computed yet (null when it can). */
export function alignmentBlocker(settings: OCAlignmentSettings): string | null {
  if (!settings.assetId) return "Choose an OCPN model.";
  const blocker = sourceBlocker(settings);
  if (blocker) return blocker;
  return settings.executionId ? null : "Choose a process execution.";
}

/** Why all executions cannot be aligned yet (null when they can). */
export function batchBlocker(settings: OCAlignmentSettings): string | null {
  if (!settings.assetId) return "Choose an OCPN model.";
  return sourceBlocker(settings);
}

/** A stable key of everything that determines the list of executions. */
export function sourceKey(settings: OCAlignmentSettings): string {
  return JSON.stringify(
    settings.source === "stored"
      ? ["stored", settings.executionColumn]
      : ["area", [...settings.businessObjectTypes].sort(), [...settings.businessActivities].sort()],
  );
}

function sameSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((v) => set.has(v));
}

/** The process area whose object types and activities equal the selection. */
export function matchingArea(settings: OCAlignmentSettings, areas: ProcessAreaSnapshot[]): string | null {
  return (
    areas.find(
      (area) =>
        sameSet(area.objectTypes, settings.businessObjectTypes) &&
        sameSet(area.activities, settings.businessActivities),
    )?.id ?? null
  );
}
