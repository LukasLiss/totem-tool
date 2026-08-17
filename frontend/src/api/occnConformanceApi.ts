import axios from "axios";

export const CONNECTED_COMPONENTS_REPLAY_STRATEGY = "connected_components" as const;
export const LEADING_OBJECT_REPLAY_STRATEGY = "leading_object" as const;
export const DEFAULT_OCCN_MAX_STATES = 1_000;
export const MAX_OCCN_MAX_STATES = 15_000;

export type OCCNReplayUnitStrategy =
  | typeof CONNECTED_COMPONENTS_REPLAY_STRATEGY
  | typeof LEADING_OBJECT_REPLAY_STRATEGY;

export type OCCNReplayStatus =
  | "fitting"
  | "non_fitting"
  | "inconclusive";

export interface OCCNReplayUnitResult {
  unit_id: string;
  status: OCCNReplayStatus;
  replayable: boolean | null;
  event_count: number;
  explored_state_count: number;
  object_types: string[];
  failure_event_index: number | null;
  failure_event_id: string | null;
  limit_reason: string | null;
}

export interface OCCNConformanceResponse {
  file_id: number;
  asset_id: number;
  replay_unit_strategy: OCCNReplayUnitStrategy;
  leading_object_type: string | null;
  max_states: number;
  fitness: number | null;
  coverage: number;
  total_units: number;
  fitting_units: number;
  non_fitting_units: number;
  inconclusive_units: number;
  unit_results: OCCNReplayUnitResult[];
}

export interface OCCNReplayUnitDetailEvent {
  event_index: number;
  event_id: string;
  activity: string;
  timestamp_unix: number;
  objects_by_type: Record<string, string[]>;
}

export interface OCCNReplayUnitDetailPagination {
  offset: number;
  limit: number;
  returned_count: number;
  total_count: number;
  has_previous: boolean;
  has_next: boolean;
  previous_offset: number | null;
  next_offset: number | null;
}

export interface OCCNReplayUnitDetailResponse {
  file_id: number;
  unit_id: string;
  replay_unit_strategy: OCCNReplayUnitStrategy;
  leading_object_type: string | null;
  event_count: number;
  object_types: string[];
  pagination: OCCNReplayUnitDetailPagination;
  events: OCCNReplayUnitDetailEvent[];
}

export interface OCCNReplayUnitDetailRequestOptions {
  replayUnitStrategy?: OCCNReplayUnitStrategy;
  leadingObjectType?: string | null;
  offset?: number;
  limit?: number;
}

export const DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT = 50;

const FILES_URL = "http://localhost:8000/api/files/";

export async function runOCCNConformance(
  eventLogId: number,
  assetId: number,
  replayUnitStrategy: OCCNReplayUnitStrategy =
    CONNECTED_COMPONENTS_REPLAY_STRATEGY,
  leadingObjectType: string | null = null,
  maxStates: number = DEFAULT_OCCN_MAX_STATES
): Promise<OCCNConformanceResponse> {
  const request: Record<string, number | string> = {
    asset_id: assetId,
    replay_unit_strategy: replayUnitStrategy,
    max_states: maxStates,
  };
  if (replayUnitStrategy === LEADING_OBJECT_REPLAY_STRATEGY) {
    request.leading_object_type = leadingObjectType ?? "";
  }
  const { data } = await axios.post<OCCNConformanceResponse>(
    `${FILES_URL}${eventLogId}/occn_conformance/`,
    request
  );
  return data;
}

export async function getEventLogObjectTypes(
  eventLogId: number
): Promise<string[]> {
  const { data } = await axios.get<string[]>(
    `${FILES_URL}${eventLogId}/object_types/`
  );
  return data;
}

export async function getOCCNReplayUnitDetail(
  eventLogId: number,
  unitId: string,
  options: OCCNReplayUnitDetailRequestOptions = {}
): Promise<OCCNReplayUnitDetailResponse> {
  const replayUnitStrategy =
    options.replayUnitStrategy ?? CONNECTED_COMPONENTS_REPLAY_STRATEGY;
  const params: Record<string, number | string> = {
    unit_id: unitId,
    replay_unit_strategy: replayUnitStrategy,
    offset: options.offset ?? 0,
    limit: options.limit ?? DEFAULT_OCCN_REPLAY_UNIT_DETAIL_LIMIT,
  };
  if (replayUnitStrategy === LEADING_OBJECT_REPLAY_STRATEGY) {
    params.leading_object_type = options.leadingObjectType ?? "";
  }
  const { data } = await axios.get<OCCNReplayUnitDetailResponse>(
    `${FILES_URL}${eventLogId}/occn_replay_unit_detail/`,
    { params }
  );
  return data;
}
