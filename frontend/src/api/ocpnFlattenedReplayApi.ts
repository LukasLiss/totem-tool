import axios from "axios";

import type { OcpnModelFile } from "@/editors/shared/model-types";

/** Token counts of one place of the combined OCPN, summed over all objects. */
export interface OcpnReplayPlaceStats {
  place_id: string;
  object_type: string;
  produced: number;
  consumed: number;
  missing: number;
  remaining: number;
  /** (missing + remaining) / (produced + missing), in [0, 1]. */
  deviation: number;
}

/** Replay result of one object type (all objects of the type together). */
export interface OcpnReplayObjectTypeResult {
  object_type: string;
  /** null when the log has no object of this type. */
  fitness: number | null;
  num_objects: number;
  num_variants: number;
  fitting_objects: number;
  produced: number;
  consumed: number;
  missing: number;
  remaining: number;
  /** Activity -> events skipped because the type's net has no such transition. */
  unmapped_activities: Record<string, number>;
  silent_search_limit_hits: number;
  warnings: string[];
}

export interface OcpnFlattenedReplayResponse {
  file_id: number;
  asset_id: number;
  asset_name: string;
  model: OcpnModelFile;
  /** Unweighted mean over the object types with at least one object. */
  average_fitness: number | null;
  object_types: OcpnReplayObjectTypeResult[];
  places: OcpnReplayPlaceStats[];
  log_object_types_not_in_model: string[];
}

export interface OcpnFlattenedReplayRequestOptions {
  /** Filter query parameters (see getEffectiveFilterConfig). */
  params?: Record<string, string>;
  skipGlobalFilter?: boolean;
  signal?: AbortSignal;
}

export async function runOcpnFlattenedReplay(
  eventLogId: number,
  assetId: number,
  options: OcpnFlattenedReplayRequestOptions = {}
): Promise<OcpnFlattenedReplayResponse> {
  const { data } = await axios.post<OcpnFlattenedReplayResponse>(
    `/api/files/${eventLogId}/ocpn_flattened_replay/`,
    { asset_id: assetId },
    {
      params: options.params,
      _skipGlobalFilter: options.skipGlobalFilter,
      signal: options.signal,
    }
  );
  return data;
}

/** A readable message for a failed replay request. */
export function extractReplayError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { error?: unknown; asset_id?: unknown; detail?: unknown }
      | undefined;
    const message = data?.error ?? data?.asset_id ?? data?.detail;
    if (typeof message === "string" && message) return message;
    if (Array.isArray(message) && typeof message[0] === "string") return message[0];
  }
  if (error instanceof Error && error.message) return error.message;
  return "The OCPN flattened replay failed.";
}
