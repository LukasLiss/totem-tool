import axios from "axios";

const BASE_URL = "http://localhost:8000/api";

function toError(e: unknown, fallback: string): Error {
  if (axios.isAxiosError(e)) {
    const msg = (e.response?.data as { error?: string } | undefined)?.error;
    return new Error(msg || `${fallback}: ${e.response?.status ?? e.message}`);
  }
  return e instanceof Error ? e : new Error(fallback);
}

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

// User edits made in the details phase, sent along with a run
export type SimulationOverrides = {
  constraints?: Record<number, VariantConstraints>;
  global_constraints?: VariantConstraints;
  arrival_distributions?: Record<number, Record<string, Record<string, number>>>;
  cooldowns?: CooldownDistribution;
  allocation_strategy?: AllocationStrategy;
  type_calendars?: Record<string, CalendarProbability>;
  resource_calendars?: Record<string, CalendarProbability>;
};

export type SimulationConfig = {
  file_id: number;
  object_types: string[];
  activities: string[];
  resource_pool: Record<string, number>;
  sim_duration_days: number;
  tick_size_s: number;
  sim_start_unix: number | null;
  resource_constraint_violation_degree: number;
  constraint_lookback_length: number | null;
  // When true, successor activities are delayed by inter-activity durations
  model_activity_durations: boolean;
  mode: SimulationMode;
  // Present once the details phase has been loaded; carries the reviewed/edited
  // constraints, calendars, cooldowns, allocation and arrival distributions.
  overrides?: SimulationOverrides;
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
  simulated_filename?: string;
  simulated_saved?: boolean;
};

export type VariantArrivalDistribution = {
  weekday_counts: Record<string, number>;
  weekday_probabilities: Record<string, number>;
  hourly_counts: Record<string, Record<string, number>>;
  hourly_probabilities: Record<string, Record<string, number>>;
  avg_arrivals_per_hour: Record<string, Record<string, number>>;
};

export type ResourceDistEntry = {
  count_distribution: Record<string, number>;
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
  log_start_unix: number | null;
  log_duration_days: number | null;
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
  try {
    const { data } = await axios.get(`${BASE_URL}/simulation/process-areas/?file_id=${fileId}`);
    return data;
  } catch (e) {
    throw toError(e, "HTTP error");
  }
}

export async function fetchSimulationDetails(config: SimulationDetailsRequest): Promise<SimulationDetailsResponse> {
  try {
    const { data } = await axios.post(`${BASE_URL}/simulation/details/`, config);
    return data;
  } catch (e) {
    throw toError(e, "HTTP error");
  }
}

export async function runSimulation(config: SimulationConfig): Promise<SimulationResult> {
  try {
    const { data } = await axios.post(`${BASE_URL}/simulation/run/`, config);
    return data;
  } catch (e) {
    throw toError(e, "HTTP error");
  }
}

// Keep a simulated run as an event log in the user's collection. Only call this
// when the user explicitly chooses to keep the log; until then the simulated
// log lives only as a temporary file on the server.
export async function saveSimulatedLog(simRunId: string): Promise<SimulatedFileInfo> {
  try {
    const { data } = await axios.post(`${BASE_URL}/simulation/save-log/`, {
      sim_run_id: simRunId,
    });
    return data;
  } catch (e) {
    throw toError(e, "HTTP error");
  }
}

// Download a simulated run's OCEL 2.0 JSON without persisting it as an event log.
export async function downloadSimulatedLog(
  simRunId: string,
  filename = "simulated_log.json",
): Promise<void> {
  let blob: Blob;
  try {
    const res = await axios.get(
      `${BASE_URL}/simulation/download-log/?sim_run_id=${encodeURIComponent(simRunId)}`,
      { responseType: "blob" },
    );
    blob = res.data;
  } catch (e) {
    throw toError(e, "Download failed");
  }
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export async function fetchGraphEditDistance(simRunId: string): Promise<number | null> {
  try {
    const { data } = await axios.post(`${BASE_URL}/simulation/graph-edit-distance/`, {
      sim_run_id: simRunId,
    });
    return data.graph_edit_distance;
  } catch (e) {
    throw toError(e, "HTTP error");
  }
}
