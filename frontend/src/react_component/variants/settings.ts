import type { ProcessAreaSnapshot } from "@/store/processAreaStore";

import {
  type AdvancedSettings,
  type ExecutionSettings,
  EXTRACTION_OPTIONS,
  ISO_OPTIONS,
  LEADING_EXTRACTIONS,
  RESOURCE_AWARE_EXTRACTION,
  type StoreSettings,
} from "./types";

export function isLeadingExtraction(extraction: ExecutionSettings["extraction"]): boolean {
  return LEADING_EXTRACTIONS.includes(extraction);
}

export function isResourceAware(extraction: ExecutionSettings["extraction"]): boolean {
  return extraction === RESOURCE_AWARE_EXTRACTION;
}

/** Column-name rules mirrored from totem_lib.ocel.event_columns. */
const COLUMN_NAME_RE = /^[A-Za-z0-9_ .:+#/()[\]-]{1,64}$/;
const FIXED_EVENT_COLUMNS = ["event_id", "activity", "timestamp_unix"];

export function columnNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a column name.";
  if (!COLUMN_NAME_RE.test(trimmed)) {
    return "Use 1–64 letters, digits, spaces or _ . : - + # / ( ) [ ].";
  }
  if (FIXED_EVENT_COLUMNS.includes(trimmed.toLowerCase())) {
    return `"${trimmed}" is a fixed column of the events table.`;
  }
  return null;
}

/**
 * Why the current settings cannot be submitted, or `null` when they can.
 * The backend validates again; this only gives immediate feedback.
 */
export function settingsBlocker(
  execution: ExecutionSettings,
  store: StoreSettings,
): string | null {
  if (isLeadingExtraction(execution.extraction) && !execution.leadingType) {
    return "Select a leading object type.";
  }
  if (isResourceAware(execution.extraction) && execution.businessObjectTypes.length === 0) {
    return "Select at least one business object type (or a process area).";
  }
  if (store.enabled) {
    const executionError = columnNameError(store.executionColumn);
    if (executionError) return `Execution column: ${executionError}`;
    if (store.computeVariants && store.storeVariantColumn) {
      const variantError = columnNameError(store.variantColumn);
      if (variantError) return `Variant column: ${variantError}`;
      if (store.variantColumn.trim() === store.executionColumn.trim()) {
        return "The execution column and the variant column must differ.";
      }
    }
  }
  return null;
}

/** Apply a process area: its object types and activities become the business ones. */
export function applyProcessArea(
  execution: ExecutionSettings,
  area: Pick<ProcessAreaSnapshot, "objectTypes" | "activities">,
): ExecutionSettings {
  return {
    ...execution,
    extraction: RESOURCE_AWARE_EXTRACTION,
    businessObjectTypes: [...area.objectTypes].sort((a, b) => a.localeCompare(b)),
    businessActivities: [...area.activities].sort((a, b) => a.localeCompare(b)),
  };
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((value) => set.has(value));
}

/** The process area whose object types and activities match the selection, if any. */
export function matchingProcessAreaId(
  execution: ExecutionSettings,
  areas: ProcessAreaSnapshot[],
): string | null {
  if (!isResourceAware(execution.extraction)) return null;
  const match = areas.find(
    (area) =>
      sameSet(area.objectTypes, execution.businessObjectTypes) &&
      sameSet(area.activities, execution.businessActivities),
  );
  return match?.id ?? null;
}

/** Human-readable label of a process area for pickers: "order, item +2 more · level 0". */
export function processAreaOptionLabel(area: ProcessAreaSnapshot, maxTypes = 3): string {
  const shown = area.objectTypes.slice(0, maxTypes).join(", ");
  const rest = area.objectTypes.length - maxTypes;
  const types = rest > 0 ? `${shown} +${rest} more` : shown;
  return `${types} · level ${area.level}`;
}

/** One-line summary of the active settings for the collapsed header. */
export function summarizeSettings(
  execution: ExecutionSettings,
  iso: AdvancedSettings["iso"],
  store: StoreSettings,
): string {
  const extraction = EXTRACTION_OPTIONS.find((o) => o.value === execution.extraction)?.label ?? execution.extraction;
  const parts = [extraction];
  if (isLeadingExtraction(execution.extraction)) {
    parts.push(execution.leadingType ? `leading: ${execution.leadingType}` : "no leading type");
  } else if (isResourceAware(execution.extraction)) {
    const n = execution.businessObjectTypes.length;
    parts.push(n === 0 ? "no business objects" : `${n} business object type${n === 1 ? "" : "s"}`);
    const a = execution.businessActivities.length;
    parts.push(a === 0 ? "all activities" : `${a} business activit${a === 1 ? "y" : "ies"}`);
  }
  if (!store.enabled || store.computeVariants) {
    parts.push(ISO_OPTIONS.find((o) => o.value === iso)?.label ?? iso);
  }
  if (store.enabled) {
    parts.push(
      store.computeVariants
        ? `store executions${store.storeVariantColumn ? " + variants" : ""}`
        : "store executions only",
    );
  }
  return parts.join(" · ");
}

/** The dashboard-persisted shape of the current settings. */
export function toAdvancedSettings(
  execution: ExecutionSettings,
  iso: AdvancedSettings["iso"],
  timeoutS: number,
): AdvancedSettings {
  return {
    extraction: execution.extraction,
    iso,
    timeout_s: timeoutS,
    leading_type: execution.leadingType,
    business_object_types: execution.businessObjectTypes,
    business_activities: execution.businessActivities,
  };
}
