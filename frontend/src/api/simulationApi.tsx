import { authFetch } from "./authApi";

const BASE_URL = "http://localhost:8000/api";

export type ProcessAreaInfo = {
  level: number;
  object_types: string[];
  activities: string[];
};

export type ProcessAreasResponse = {
  all_object_types: string[];
  all_activities: string[];
  object_type_counts: Record<string, number>;
  object_type_to_activities: Record<string, string[]>;
  process_areas: ProcessAreaInfo[];
  log_start_unix: number | null;
  log_end_unix: number | null;
  log_duration_days: number | null;
};

export type SimulationMode = "simple" | "advanced";

export type SimulationConfig = {
  file_id: number;
  object_types: string[];
  activities: string[];
  resource_pool: Record<string, number>;
  sim_duration_days: number;
  tick_size_s: number;
  resource_constraint_violation_degree: number;
  constraint_lookback_length: number | null;
  mode: SimulationMode;
};

export type CycleTimeSummary = {
  mean_s: number;
  std_s: number;
  min_s: number;
  max_s: number;
  count: number;
};

export type CountRow = {
  metric: string;
  actual: number;
  simulated: number;
  abs_diff: number;
  rel_diff: number | null;
};

export type PaperEvaluationResult = {
  counts: CountRow[];
  control_flow: {
    n_gram_distance_absolute: number;
    n_gram_distance_relative: number;
  };
  temporal: {
    absolute_event_distribution: number;
    circadian_event_distribution: number;
    relative_event_distribution: number;
  };
  congestion: {
    cycle_time_distribution: number;
    interarrival_time_distribution: number;
    execution_arrival_rate: number;
    execution_arrival_count: number;
    variant_arrival_distribution: number;
    variant_arrival_count: number;
    cycle_time_actual: CycleTimeSummary;
    cycle_time_simulated: CycleTimeSummary;
  };
  object_centric: {
    object_counts: { type: string; actual: number; simulated: number; abs_diff: number }[];
    cardinality: { anchor: string; related: string; emd: number }[];
    lifecycle: { type: string; length_emd: number; time_s_emd: number }[];
    graph_edit_distance: number | null;
  };
  resources: {
    per_type: {
      type: string;
      n_actual: number;
      n_simulated: number;
      events_actual: number;
      events_simulated: number;
      events_per_resource_emd: number;
      mean_utilization_actual: number | null;
      mean_utilization_simulated: number | null;
    }[];
    observation_window_actual_s: number;
    observation_window_simulated_s: number;
  };
  runtime: {
    simulation_s: number;
  };
};

export type SimulatedFileInfo = {
  id: number;
  project: number;
  file: string;
  uploaded_at: string;
};

export type SimulationResult = {
  finished_instances: number;
  spawned_instances: number;
  completion_ratio: number;
  simulated_events: number;
  simulated_objects: number;
  evaluation: PaperEvaluationResult | null;
  evaluation_error?: string | null;
  sim_run_id?: string;
  simulated_file?: SimulatedFileInfo;
};

export type VariantArrivalDistribution = {
  weekday_counts: Record<string, number>;
  weekday_probabilities: Record<string, number>;
  hourly_counts: Record<string, Record<string, number>>;
  hourly_probabilities: Record<string, Record<string, number>>;
  avg_arrivals_per_hour: Record<string, Record<string, number>>;
};

export type ResourceDistEntry = {
  mean_count: number;
  min_count: number;
  max_count: number;
};

export type VariantConstraints = Record<string, Record<string, string>>;

export type CooldownEntry = {
  mean_duration_s: number;
  std_duration_s: number;
  min_duration_s: number;
  max_duration_s: number;
  sample_count: number;
};

export type CooldownDistribution = Record<string, Record<string, CooldownEntry>>;

export type AllocationStrategy = Record<string, string>;

export type VariantDetail = {
  id: number;
  support: number;
  activity_sequence: string[];
  arrival_distribution: VariantArrivalDistribution;
  resource_distribution: Record<string, Record<string, ResourceDistEntry>>;
  constraints: VariantConstraints;
};

// Resource Calendar: weekday -> hour[] (24 floats)
export type CalendarProbability = Record<string, number[]>;

export type SimulationDetailsResponse = {
  variants: VariantDetail[];
  num_variants: number;
  cooldown_distribution: CooldownDistribution;
  allocation_strategy: AllocationStrategy;
  type_calendars: Record<string, CalendarProbability>;
  resource_calendars: Record<string, CalendarProbability>;
};

export type SimulationDetailsRequest = {
  file_id: number;
  object_types: string[];
  activities: string[];
  resource_types?: string[];
  support_threshold?: number;
  min_occurrences_within?: number;
  min_occurrences_across?: number;
};

export async function fetchProcessAreas(fileId: number): Promise<ProcessAreasResponse> {
  const res = await authFetch(`${BASE_URL}/simulation/process-areas/?file_id=${fileId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchSimulationDetails(config: SimulationDetailsRequest): Promise<SimulationDetailsResponse> {
  const res = await authFetch(`${BASE_URL}/simulation/details/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function runSimulation(config: SimulationConfig): Promise<SimulationResult> {
  const res = await authFetch(`${BASE_URL}/simulation/run/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchGraphEditDistance(simRunId: string): Promise<number | null> {
  const res = await authFetch(`${BASE_URL}/simulation/graph-edit-distance/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sim_run_id: simRunId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.graph_edit_distance;
}
