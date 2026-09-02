import axios from "axios";

import type { ProcessAreaSnapshot, ProcessAreasSnapshot } from "@/store/processAreaStore";

import { isLeadingExtraction, isResourceAware } from "./settings";
import type {
  ExecutionSettings,
  GroupingSettings,
  StoredExecutionsResponse,
  StoreSettings,
  VariantsResponse,
} from "./types";

export type NamedCount = { name: string; count: number };

export async function fetchObjectTypes(fileId: number): Promise<string[]> {
  const { data } = await axios.get<NamedCount[]>(`/api/files/${fileId}/object_types/`, {
    _skipGlobalFilter: true,
  });
  return data.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
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
): Promise<VariantsResponse> {
  const params = buildExtractionParams(execution);
  params.set("file_id", String(fileId));
  params.set("iso", grouping.iso);
  params.set("timeout_s", String(grouping.timeoutS));
  const { data } = await axios.get<VariantsResponse | VariantsResponse["variants"]>(
    `/api/variants/?${params.toString()}`,
    { _skipGlobalFilter: !filterEnabled },
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
): Promise<StoredExecutionsResponse> {
  const { data } = await axios.post<StoredExecutionsResponse>(
    `/api/files/${fileId}/process_executions/`,
    buildStoreBody(execution, grouping, store),
    { _skipGlobalFilter: !filterEnabled },
  );
  return data;
}

type ProcessAreaPayload = {
  layers?: Array<{ level: number; areas: Array<{ objectTypes: string[]; eventTypes?: string[] }> }>;
  object_type_to_event_types?: Record<string, string[]>;
};

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
): Promise<Omit<ProcessAreasSnapshot, "computedAt">> {
  const { data } = await axios.get<ProcessAreaPayload>(
    `/api/files/${fileId}/discover_process_areas/`,
    { _skipGlobalFilter: !filterEnabled },
  );
  const layers = [...(data.layers ?? [])].sort((a, b) => b.level - a.level);
  const areas: ProcessAreaSnapshot[] = layers.flatMap((layer) =>
    layer.areas.map((area, index) => ({
      id: `level-${layer.level}-area-${index}-${area.objectTypes.join("-")}`,
      level: layer.level,
      label: area.objectTypes.length === 1 ? area.objectTypes[0] : area.objectTypes.join(" & "),
      objectTypes: area.objectTypes,
      activities: area.eventTypes ?? [],
    })),
  );
  return {
    fileId,
    algorithm: "advanced",
    filtered: filterEnabled,
    areas,
    objectTypeToActivities: data.object_type_to_event_types ?? {},
  };
}

/** A user-facing message for a failed variants / store request. */
export function describeRequestError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { code?: string; timeout_s?: number; hint?: string; error?: string } | undefined;
    if (error.response?.status === 408 && data?.code === "timeout") {
      return `Computation timed out after ${data.timeout_s}s. ${data.hint ?? ""}`.trim();
    }
    if (data?.error) return data.error;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
