import axios from "axios";

export const CONNECTED_COMPONENTS_REPLAY_STRATEGY = "connected_components" as const;

export type OCCNReplayUnitStrategy =
  typeof CONNECTED_COMPONENTS_REPLAY_STRATEGY;

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
  fitness: number | null;
  coverage: number;
  total_units: number;
  fitting_units: number;
  non_fitting_units: number;
  inconclusive_units: number;
  unit_results: OCCNReplayUnitResult[];
}

const FILES_URL = "http://localhost:8000/api/files/";

export async function runOCCNConformance(
  eventLogId: number,
  assetId: number,
  replayUnitStrategy: OCCNReplayUnitStrategy =
    CONNECTED_COMPONENTS_REPLAY_STRATEGY
): Promise<OCCNConformanceResponse> {
  const { data } = await axios.post<OCCNConformanceResponse>(
    `${FILES_URL}${eventLogId}/occn_conformance/`,
    {
      asset_id: assetId,
      replay_unit_strategy: replayUnitStrategy,
    }
  );
  return data;
}
