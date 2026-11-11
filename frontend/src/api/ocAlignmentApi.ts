import axios from "axios";

/** Where the aligned process execution comes from. */
export type OCAlignmentSource = "area" | "stored";

export const DEFAULT_OC_ALIGNMENT_MAX_STATES = 200_000;
export const MIN_OC_ALIGNMENT_MAX_STATES = 1_000;
export const MAX_OC_ALIGNMENT_MAX_STATES = 2_000_000;
export const DEFAULT_OC_ALIGNMENT_TIMEOUT_S = 60;
export const MAX_OC_ALIGNMENT_TIMEOUT_S = 600;

/** The execution source as the backend expects it. */
export interface OCAlignmentSourceRequest {
  source: OCAlignmentSource;
  /** Stored source: the events column with the execution ids. */
  executionColumn?: string;
  /** Area source: objects of these types form the executions. */
  businessObjectTypes?: string[];
  /** Area source: only these activities connect objects and are aligned (empty = all). */
  businessActivities?: string[];
}

export interface OCAlignmentExecutionSummary {
  id: string;
  event_count: number;
  object_count: number;
  activity_count: number;
  start_unix: number | null;
  end_unix: number | null;
  object_type_counts: Record<string, number>;
  /** Present when the listing was requested for a model. */
  ignored_object_types?: string[];
}

export interface OCAlignmentExecutionsResponse {
  file_id: number;
  source: OCAlignmentSource;
  execution_column: string | null;
  business_object_types: string[];
  business_activities: string[];
  model_object_types: string[] | null;
  total: number;
  truncated: boolean;
  executions: OCAlignmentExecutionSummary[];
}

export type OCAlignmentMoveKind = "sync" | "log" | "model";

export interface OCAlignmentMove {
  index: number;
  kind: OCAlignmentMoveKind;
  silent: boolean;
  cost: number;
  event_index: number | null;
  event_id: string | null;
  timestamp_unix: number | null;
  log_activity: string | null;
  log_objects: Record<string, string[]>;
  transition_id: string | null;
  model_activity: string | null;
  model_objects: Record<string, string[]>;
}

export type OCAlignmentStatus =
  | "optimal"
  /** A valid alignment from the fallback search; its cost is an upper bound. */
  | "approximate"
  | "no_alignment"
  | "state_limit"
  | "timeout"
  | "empty_execution";

export interface OCAlignmentExecutionDetail extends OCAlignmentExecutionSummary {
  objects_by_type: Record<string, string[]>;
  events: {
    event_id: string;
    activity: string;
    timestamp_unix: number;
    objects_by_type: Record<string, string[]>;
  }[];
  edges: [number, number][];
}

export interface OCAlignmentProjection {
  ignored_object_types: string[];
  ignored_object_counts: Record<string, number>;
  ignored_object_count: number;
  dropped_event_ids: string[];
  dropped_event_count: number;
}

export interface OCAlignmentResponse {
  file_id: number;
  asset_id: number;
  execution_id: string;
  source: OCAlignmentSource;
  execution_column: string | null;
  business_object_types: string[];
  business_activities: string[];
  max_states: number;
  timeout_s: number;
  model_object_types: string[];
  status: OCAlignmentStatus;
  message: string;
  cost: number | null;
  /** False when the alignment is not guaranteed to be optimal. */
  exact: boolean;
  /** Admissible lower bound of the optimal cost. */
  lower_bound: number | null;
  restricted_transitions: string[];
  moves: OCAlignmentMove[];
  edges: [number, number][];
  move_counts: { sync: number; log: number; model: number; silent: number };
  synchronous_event_ratio: number | null;
  deviations_by_activity: { activity: string; sync: number; log: number; model: number }[];
  deviations_by_object: {
    object_type: string;
    object_id: string;
    sync: number;
    log: number;
    model: number;
  }[];
  unknown_activities: string[];
  /** Concrete reasons when no alignment exists. */
  diagnostics?: string[];
  states_explored: number;
  states_queued: number;
  elapsed_ms: number;
  execution: OCAlignmentExecutionDetail;
  projection: OCAlignmentProjection;
}

export type OCAlignmentBatchStatus = OCAlignmentStatus | "skipped";

export interface OCAlignmentBatchRow {
  id: string;
  event_count: number;
  object_count: number;
  object_type_counts: Record<string, number>;
  start_unix: number | null;
  status: OCAlignmentBatchStatus;
  cost: number | null;
  exact: boolean;
  lower_bound: number | null;
  move_counts: { sync: number; log: number; model: number; silent: number } | null;
  ignored_object_types: string[];
  message: string;
  diagnostics?: string[];
  elapsed_ms: number;
}

export interface OCAlignmentBatchResponse {
  file_id: number;
  asset_id: number;
  source: OCAlignmentSource;
  max_states: number;
  timeout_s: number;
  total_timeout_s: number;
  model_object_types: string[];
  total: number;
  status_counts: Partial<Record<OCAlignmentBatchStatus, number>>;
  aligned: number;
  fitting: number;
  exact: number;
  average_cost: number | null;
  cost_per_event: number | null;
  synchronous_event_ratio: number | null;
  deviations_by_activity: { activity: string; sync: number; log: number; model: number; executions: number }[];
  /** Object type -> number of executions in which it was ignored. */
  ignored_object_types: Record<string, number>;
  stopped_early: boolean;
  elapsed_ms: number;
  rows: OCAlignmentBatchRow[];
}

export const DEFAULT_OC_ALIGNMENT_BATCH_MAX_STATES = 50_000;
export const DEFAULT_OC_ALIGNMENT_BATCH_TIMEOUT_S = 5;
export const DEFAULT_OC_ALIGNMENT_BATCH_TOTAL_TIMEOUT_S = 240;

const FILES_URL = "/api/files/";

export function buildSourceBody(source: OCAlignmentSourceRequest): Record<string, unknown> {
  if (source.source === "stored") {
    return { source: "stored", execution_column: source.executionColumn ?? "" };
  }
  return {
    source: "area",
    business_object_types: source.businessObjectTypes ?? [],
    business_activities: source.businessActivities ?? [],
  };
}

/** Process executions a source yields (annotated with ignored types when a model is given). */
export async function listOCAlignmentExecutions(
  eventLogId: number,
  source: OCAlignmentSourceRequest,
  assetId?: number | null,
  options: { signal?: AbortSignal; filterEnabled?: boolean } = {},
): Promise<OCAlignmentExecutionsResponse> {
  const body = buildSourceBody(source);
  if (assetId) body.asset_id = assetId;
  const { data } = await axios.post<OCAlignmentExecutionsResponse>(
    `${FILES_URL}${eventLogId}/oc_alignment_executions/`,
    body,
    { signal: options.signal, _skipGlobalFilter: options.filterEnabled === false },
  );
  return data;
}

export async function computeOCAlignment(
  eventLogId: number,
  assetId: number,
  source: OCAlignmentSourceRequest,
  executionId: string,
  options: {
    maxStates?: number;
    timeoutS?: number;
    signal?: AbortSignal;
    /** False skips the global filter (default: the global filter applies). */
    filterEnabled?: boolean;
  } = {},
): Promise<OCAlignmentResponse> {
  const body: Record<string, unknown> = {
    ...buildSourceBody(source),
    asset_id: assetId,
    execution_id: executionId,
    max_states: options.maxStates ?? DEFAULT_OC_ALIGNMENT_MAX_STATES,
    timeout_s: options.timeoutS ?? DEFAULT_OC_ALIGNMENT_TIMEOUT_S,
  };
  const { data } = await axios.post<OCAlignmentResponse>(
    `${FILES_URL}${eventLogId}/oc_alignment/`,
    body,
    { signal: options.signal, _skipGlobalFilter: options.filterEnabled === false },
  );
  return data;
}

/** Alignments of every execution of a source (one compact row each + aggregates). */
export async function computeOCAlignmentBatch(
  eventLogId: number,
  assetId: number,
  source: OCAlignmentSourceRequest,
  options: {
    maxStates?: number;
    timeoutS?: number;
    totalTimeoutS?: number;
    signal?: AbortSignal;
    filterEnabled?: boolean;
  } = {},
): Promise<OCAlignmentBatchResponse> {
  const body: Record<string, unknown> = {
    ...buildSourceBody(source),
    asset_id: assetId,
    max_states: options.maxStates ?? DEFAULT_OC_ALIGNMENT_BATCH_MAX_STATES,
    timeout_s: options.timeoutS ?? DEFAULT_OC_ALIGNMENT_BATCH_TIMEOUT_S,
    total_timeout_s: options.totalTimeoutS ?? DEFAULT_OC_ALIGNMENT_BATCH_TOTAL_TIMEOUT_S,
  };
  const { data } = await axios.post<OCAlignmentBatchResponse>(
    `${FILES_URL}${eventLogId}/oc_alignment_batch/`,
    body,
    { signal: options.signal, _skipGlobalFilter: options.filterEnabled === false },
  );
  return data;
}

/** A user-facing message for a failed alignment request (field errors included). */
export function describeOCAlignmentError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as Record<string, unknown> | undefined;
    if (error.response?.status === 499 || data?.code === "cancelled") {
      return "Computation cancelled.";
    }
    if (data && typeof data === "object") {
      if (typeof data.error === "string") return data.error;
      for (const value of Object.values(data)) {
        if (typeof value === "string") return value;
        if (Array.isArray(value) && typeof value[0] === "string") return value[0];
      }
    }
  }
  if (error instanceof Error && error.name === "CanceledError") return "Computation cancelled.";
  return error instanceof Error && error.message ? error.message : fallback;
}
