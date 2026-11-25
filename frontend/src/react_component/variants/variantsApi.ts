import axios from "axios";
import { isCancelledError } from "@/store/computationStore";
import { getEffectiveFilterConfig } from "@/store/filterStore";
import type { ProcessAreaSnapshot, ProcessAreasSnapshot } from "@/store/processAreaStore";

import { isLeadingExtraction, isResourceAware } from "./settings";
import type {
  ExecutionSettings,
  GroupingSettings,
  ProcessAreaColumns,
  ProcessAreaRequest,
  ProcessAreaVariantsResponse,
  StoredExecutionsResponse,
  StoreSettings,
  VariantsResponse,
} from "./types";

export type NamedCount = { name: string; count: number };

/** Object types with the number of objects of each type, sorted by name. */
export async function fetchObjectTypeCounts(fileId: number): Promise<NamedCount[]> {
  const { data } = await axios.get<NamedCount[]>(`/api/files/${fileId}/object_types/`, {
    _skipGlobalFilter: true,
  });
  return [...data].sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchObjectTypes(fileId: number): Promise<string[]> {
  return (await fetchObjectTypeCounts(fileId)).map((entry) => entry.name);
}

export async function fetchActivities(fileId: number): Promise<string[]> {
  const { data } = await axios.get<NamedCount[]>(`/api/files/${fileId}/activities/`, {
    _skipGlobalFilter: true,
  });
  return data.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
}

/** Query parameters describing the extraction (lists as repeated params). */
export function buildExtractionParams(execution: ExecutionSettings): URLSearchParams {
  const params = new URLSearchParams();
  params.set("extraction", execution.extraction);
  if (isLeadingExtraction(execution.extraction) && execution.leadingType) {
    params.set("leading_type", execution.leadingType);
  }
  if (isResourceAware(execution.extraction)) {
    for (const objectType of execution.businessObjectTypes) {
      params.append("business_object_types", objectType);
    }
    for (const activity of execution.businessActivities) {
      params.append("business_activities", activity);
    }
  }
  return params;
}

export async function fetchVariants(
  fileId: number,
  execution: ExecutionSettings,
  grouping: GroupingSettings,
  filterEnabled: boolean,
  localFilterParams?: Record<string, string>,
): Promise<VariantsResponse> {
  const params = buildExtractionParams(execution);
  params.set("file_id", String(fileId));
  params.set("iso", grouping.iso);
  params.set("timeout_s", String(grouping.timeoutS));
  const filterConfig = getEffectiveFilterConfig(localFilterParams, filterEnabled);
  if (filterConfig._noResults) return { variants: [], object_types: [] };
  if (filterConfig.params) {
    Object.entries(filterConfig.params).forEach(([k, v]) => params.set(k, v));
  }
  const { data } = await axios.get<VariantsResponse | VariantsResponse["variants"]>(
    `/api/variants/?${params.toString()}`,
    { _skipGlobalFilter: filterConfig._skipGlobalFilter },
  );
  // Older backends returned the bare list.
  return Array.isArray(data) ? { variants: data, object_types: [] } : data;
}

/** JSON body for `POST /api/files/{id}/process_executions/`. */
export function buildStoreBody(
  execution: ExecutionSettings,
  grouping: GroupingSettings,
  store: StoreSettings,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    extraction: execution.extraction,
    execution_column: store.executionColumn.trim(),
    compute_variants: store.computeVariants,
    timeout_s: grouping.timeoutS,
  };
  if (isLeadingExtraction(execution.extraction) && execution.leadingType) {
    body.leading_type = execution.leadingType;
  }
  if (isResourceAware(execution.extraction)) {
    body.business_object_types = execution.businessObjectTypes;
    body.business_activities = execution.businessActivities;
  }
  if (store.computeVariants) {
    body.iso = grouping.iso;
    if (store.storeVariantColumn) body.variant_column = store.variantColumn.trim();
  }
  return body;
}

export async function storeProcessExecutions(
  fileId: number,
  execution: ExecutionSettings,
  grouping: GroupingSettings,
  store: StoreSettings,
  filterEnabled: boolean,
  localFilterParams?: Record<string, string>,
): Promise<StoredExecutionsResponse> {
  const filterConfig = getEffectiveFilterConfig(localFilterParams, filterEnabled);
  if (filterConfig._noResults) return { executions: [], variants: [], object_types: [] } as unknown as StoredExecutionsResponse;
  const body = { ...buildStoreBody(execution, grouping, store), ...(filterConfig.params ?? {}) };
  const { data } = await axios.post<StoredExecutionsResponse>(
    `/api/files/${fileId}/process_executions/`,
    body,
    { _skipGlobalFilter: filterConfig._skipGlobalFilter },
  );
  return data;
}

/** Names of the attribute / derived columns of the events table. */
export async function fetchEventColumnNames(fileId: number): Promise<string[]> {
  const { data } = await axios.get<Array<{ name: string }>>(`/api/files/${fileId}/event_columns/`, {
    _skipGlobalFilter: true,
  });
  return data.map((column) => column.name);
}

/**
 * The request payload for one process area. A named area (of a stored or
 * hand-edited composition) is labelled by its name, others by their types.
 */
export function toProcessAreaRequest(
  area: Pick<ProcessAreaSnapshot, "objectTypes" | "activities"> & { name?: string },
): ProcessAreaRequest {
  const objectTypes = [...area.objectTypes].sort((a, b) => a.localeCompare(b));
  return {
    label: area.name?.trim() || objectTypes.join(", "),
    object_types: objectTypes,
    activities: [...area.activities].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Process areas in tab order: the bottom layer (the core business objects)
 * first, resources last; ties by name.
 */
export function orderProcessAreas<T extends Pick<ProcessAreaSnapshot, "level" | "objectTypes">>(
  areas: T[],
): T[] {
  return [...areas].sort(
    (a, b) =>
      a.level - b.level ||
      a.objectTypes.join(", ").localeCompare(b.objectTypes.join(", ")),
  );
}

/**
 * Connected components per process area: one variant list per area, and
 * (when ``store``) the execution / variant ids written into two columns.
 */
export async function computeProcessAreaVariants(
  fileId: number,
  areas: ProcessAreaRequest[],
  grouping: GroupingSettings,
  options: { store: boolean; columns: ProcessAreaColumns },
  filterEnabled: boolean,
  localFilterParams?: Record<string, string>,
): Promise<ProcessAreaVariantsResponse> {
  const filterConfig = getEffectiveFilterConfig(localFilterParams, filterEnabled);
  if (filterConfig._noResults) {
    return {
      file_id: fileId,
      stored: false,
      execution_column: null,
      variant_column: null,
      execution_count: 0,
      variant_count: 0,
      total_event_count: 0,
      assigned_event_count: 0,
      ambiguous_event_count: 0,
      unassigned_event_count: 0,
      areas: areas.map((area) => ({
        ...area,
        execution_count: 0,
        variant_count: 0,
        variants: [],
        skipped_reason: "The filter leaves no events.",
      })),
      object_types: [],
    };
  }
  const body: Record<string, unknown> = {
    areas,
    iso: grouping.iso,
    timeout_s: grouping.timeoutS,
    store: options.store,
  };
  if (options.store) {
    body.execution_column = options.columns.executionColumn.trim();
    body.variant_column = options.columns.variantColumn.trim();
  }
  const { data } = await axios.post<ProcessAreaVariantsResponse>(
    `/api/files/${fileId}/process_area_variants/`,
    body,
    // Filters go in the query string, where the backend reads them.
    { params: filterConfig.params, _skipGlobalFilter: filterConfig._skipGlobalFilter },
  );
  return data;
}

type ProcessAreaPayload = {
  layers?: Array<{ level: number; areas: Array<{ objectTypes: string[]; eventTypes?: string[] }> }>;
  object_type_to_event_types?: Record<string, string[]>;
};

/**
 * The areas of a discovery result as snapshot entries (highest level first).
 * The ids mirror `buildLayersFromBackend` in TotemVisualizer so every
 * component agrees on what an area is called.
 */
export function discoveredSnapshotAreas(layers: NonNullable<ProcessAreaPayload["layers"]>): ProcessAreaSnapshot[] {
  return [...layers]
    .sort((a, b) => b.level - a.level)
    .flatMap((layer) =>
      layer.areas.map((area, index) => ({
        id: `level-${layer.level}-area-${index}-${area.objectTypes.join("-")}`,
        level: layer.level,
        label: area.objectTypes.length === 1 ? area.objectTypes[0] : area.objectTypes.join(" & "),
        objectTypes: area.objectTypes,
        activities: area.eventTypes ?? [],
      })),
    );
}

/**
 * Compute process areas with the default (advanced) algorithm.
 *
 * Used when the Process Area component has not been opened yet for this
 * log; the ids mirror `buildLayersFromBackend` in TotemVisualizer so the two
 * agree on what an area is called.
 */
export async function fetchProcessAreas(
  fileId: number,
  filterEnabled: boolean,
  localFilterParams?: Record<string, string>,
): Promise<Omit<ProcessAreasSnapshot, "computedAt">> {
  const filterConfig = getEffectiveFilterConfig(localFilterParams, filterEnabled);
  if (filterConfig._noResults) return { fileId, algorithm: "advanced", filtered: filterEnabled, areas: [], objectTypeToActivities: {} };
  const { data } = await axios.get<ProcessAreaPayload>(
    `/api/files/${fileId}/discover_process_areas/`,
    filterConfig,
  );
  return {
    fileId,
    algorithm: "advanced",
    filtered: filterEnabled,
    areas: discoveredSnapshotAreas(data.layers ?? []),
    objectTypeToActivities: data.object_type_to_event_types ?? {},
  };
}

/** A user-facing message for a failed variants / store request. */
export function describeRequestError(error: unknown, fallback: string): string {
  if (isCancelledError(error)) return "Computation cancelled.";
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { code?: string; timeout_s?: number; hint?: string; error?: string } | undefined;
    if (error.response?.status === 408 && data?.code === "timeout") {
      return `Computation timed out after ${data.timeout_s}s. ${data.hint ?? ""}`.trim();
    }
    if (data?.error) return data.error;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
