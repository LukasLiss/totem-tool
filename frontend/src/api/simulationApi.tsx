const BASE_URL = "http://localhost:8000/api";

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token");
  if (!token) throw new Error("Not authenticated");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
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

export type EvaluationResult = {
  event_count: { original: number; simulated: number };
  activity_frequencies: Record<string, { original: number; simulated: number; diff: number }>;
  object_type_counts: Record<string, { original: number; simulated: number }>;
  variants: {
    original_count: number;
    simulated_count: number;
    original_frequencies: number[];
    simulated_frequencies: number[];
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
  simulated_events: number;
  simulated_objects: number;
  evaluation: EvaluationResult;
  simulated_file?: SimulatedFileInfo;
};

export type VariantArrivalDistribution = {
  weekday_counts: Record<string, number>;
  weekday_probabilities: Record<string, number>;
  avg_arrivals_per_hour: Record<string, Record<string, number>>;
  hourly_counts: Record<string, Record<string, number>>;
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

// cooldown_distribution: { activity: { resource_type: CooldownEntry } }
export type CooldownDistribution = Record<string, Record<string, CooldownEntry>>;

// allocation_strategy: { resource_type: "FIFO" | "LIFO" | "random" }
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
  const res = await fetch(`${BASE_URL}/simulation/process-areas/?file_id=${fileId}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchSimulationDetails(config: SimulationDetailsRequest): Promise<SimulationDetailsResponse> {
  const res = await fetch(`${BASE_URL}/simulation/details/`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function runSimulation(config: SimulationConfig): Promise<SimulationResult> {
  const res = await fetch(`${BASE_URL}/simulation/run/`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
