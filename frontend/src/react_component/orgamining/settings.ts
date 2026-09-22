/**
 * Settings of the two organizational mining explorers, shared between the
 * analysis views, the dashboard widgets (which persist them) and the widgets'
 * edit forms.
 *
 * The `*FromNode` / `*ToNode` helpers translate between the camelCase
 * settings the explorers work with and the snake_case fields the backend
 * component models store (`OCHandoverComponent`, `ResourceProfilingComponent`).
 */

import type { GridStackWidget } from "gridstack";

// ---------------------------------------------------------------------------
// Handover of work
// ---------------------------------------------------------------------------

export type HandoverMethod = "oc" | "flattened";
export type HandoverNormalization = "by_source" | "by_target" | "by_arcs_in_eog" | "by_total_weight";
export type HandoverNormalizationScope = "global" | "per_bo_type";
export type HandoverViewMode = "graph" | "table" | "log";

export const HANDOVER_METHODS: HandoverMethod[] = ["oc", "flattened"];
export const HANDOVER_METHOD_LABELS: Record<HandoverMethod, string> = {
  oc: "Object-centric",
  flattened: "Flattened (single case type)",
};
export const HANDOVER_NORMALIZATIONS: HandoverNormalization[] = [
  "by_source",
  "by_target",
  "by_arcs_in_eog",
  "by_total_weight",
];
export const NORMALIZATION_LABELS: Record<HandoverNormalization, string> = {
  by_source: "By Source",
  by_target: "By Target",
  by_arcs_in_eog: "By Arcs in EOG",
  by_total_weight: "By Total Weight",
};
export const HANDOVER_VIEW_MODES: HandoverViewMode[] = ["graph", "table", "log"];

export type HandoverSettings = {
  method: HandoverMethod;
  resourceTypes: string[];
  businessObjectTypes: string[];
  /** Flattened method only. */
  caseType: string;
  flatResourceType: string;
  /** `null` = unlimited. */
  maxGap: number | null;
  normalization: HandoverNormalization;
  normalizationScope: HandoverNormalizationScope;
  parallelFilterEnabled: boolean;
  parallelThreshold: number;
  minParallelObservations: number;
  clusterByOt: boolean;
  viewMode: HandoverViewMode;
};

export const DEFAULT_HANDOVER_SETTINGS: HandoverSettings = {
  method: "oc",
  resourceTypes: [],
  businessObjectTypes: [],
  caseType: "",
  flatResourceType: "",
  maxGap: null,
  normalization: "by_arcs_in_eog",
  normalizationScope: "global",
  parallelFilterEnabled: false,
  parallelThreshold: 0.5,
  minParallelObservations: 1,
  clusterByOt: false,
  viewMode: "graph",
};

// ---------------------------------------------------------------------------
// Resource profiling
// ---------------------------------------------------------------------------

export type FeatureGroup =
  | "activity_fractions"
  | "cooccurrence_fractions"
  | "object_collaboration_fractions"
  | "object_portfolio_fractions"
  | "time_fractions"
  | "weekday_fractions";
export type ProfilingClusterMethod = "kmeans" | "agglomerative" | "hdbscan";
export type ProfilingDistanceMetric = "euclidean" | "hellinger";
export type ProfilingViewMode = "graph" | "table";

export const FEATURE_GROUP_OPTIONS: { key: FeatureGroup; label: string }[] = [
  { key: "activity_fractions", label: "Activity fractions" },
  { key: "cooccurrence_fractions", label: "Co-occurrence" },
  { key: "object_collaboration_fractions", label: "Object collaboration" },
  { key: "object_portfolio_fractions", label: "BO type fractions" },
  { key: "time_fractions", label: "Time binning (hourly)" },
  { key: "weekday_fractions", label: "Time binning (weekly)" },
];
export const FEATURE_GROUPS: FeatureGroup[] = FEATURE_GROUP_OPTIONS.map((o) => o.key);
/** Feature groups that need business objects (and hence a business object type selection). */
export const BUSINESS_OBJECT_FEATURE_GROUPS: FeatureGroup[] = [
  "object_collaboration_fractions",
  "object_portfolio_fractions",
];
export const PROFILING_CLUSTER_METHODS: ProfilingClusterMethod[] = ["kmeans", "agglomerative", "hdbscan"];
export const PROFILING_CLUSTER_METHOD_LABELS: Record<ProfilingClusterMethod, string> = {
  kmeans: "K-Means",
  agglomerative: "Agglomerative",
  hdbscan: "HDBSCAN",
};
export const PROFILING_DISTANCE_METRICS: ProfilingDistanceMetric[] = ["euclidean", "hellinger"];
export const PROFILING_DISTANCE_METRIC_LABELS: Record<ProfilingDistanceMetric, string> = {
  euclidean: "Euclidean",
  hellinger: "Hellinger",
};
export const PROFILING_VIEW_MODES: ProfilingViewMode[] = ["graph", "table"];

export type ResourceProfilingSettings = {
  resourceTypes: string[];
  /** Empty = every non-resource type (the explorer's default). */
  businessObjectTypes: string[];
  featureGroups: FeatureGroup[];
  tooltipFeatureGroups: FeatureGroup[];
  computeClusters: boolean;
  clusterMethod: ProfilingClusterMethod;
  nClusters: number;
  minClusterSize: number;
  distanceMetric: ProfilingDistanceMetric;
  viewMode: ProfilingViewMode;
};

export const DEFAULT_PROFILING_SETTINGS: ResourceProfilingSettings = {
  resourceTypes: [],
  businessObjectTypes: [],
  featureGroups: ["activity_fractions"],
  tooltipFeatureGroups: [],
  computeClusters: true,
  clusterMethod: "hdbscan",
  nClusters: 3,
  minClusterSize: 2,
  distanceMetric: "euclidean",
  viewMode: "graph",
};

// ---------------------------------------------------------------------------
// Persisted widget fields <-> settings
// ---------------------------------------------------------------------------

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/** The persisted (snake_case) fields of the handover widget. */
export type HandoverWidgetFields = {
  method?: HandoverMethod;
  resource_types?: string[];
  businessobject_types?: string[];
  case_type?: string;
  flat_resource_type?: string;
  max_gap?: number | null;
  normalization?: HandoverNormalization;
  normalization_scope?: HandoverNormalizationScope;
  parallel_filter_enabled?: boolean;
  parallel_threshold?: number;
  min_parallel_observations?: number;
  cluster_by_ot?: boolean;
  view_mode?: HandoverViewMode | ProfilingViewMode;
};

export function handoverSettingsFromNode(node: HandoverWidgetFields): HandoverSettings {
  const d = DEFAULT_HANDOVER_SETTINGS;
  const maxGapRaw = node.max_gap;
  const maxGap =
    maxGapRaw === null || maxGapRaw === undefined
      ? null
      : Math.max(0, Math.round(finiteNumber(maxGapRaw, 0)));
  return {
    method: oneOf(node.method, HANDOVER_METHODS, d.method),
    resourceTypes: stringList(node.resource_types),
    businessObjectTypes: stringList(node.businessobject_types),
    caseType: typeof node.case_type === "string" ? node.case_type : d.caseType,
    flatResourceType: typeof node.flat_resource_type === "string" ? node.flat_resource_type : d.flatResourceType,
    maxGap,
    normalization: oneOf(node.normalization, HANDOVER_NORMALIZATIONS, d.normalization),
    normalizationScope: oneOf(node.normalization_scope, ["global", "per_bo_type"] as const, d.normalizationScope),
    parallelFilterEnabled: Boolean(node.parallel_filter_enabled ?? d.parallelFilterEnabled),
    parallelThreshold: Math.min(1, Math.max(0, finiteNumber(node.parallel_threshold, d.parallelThreshold))),
    minParallelObservations: Math.max(1, Math.round(finiteNumber(node.min_parallel_observations, d.minParallelObservations))),
    clusterByOt: Boolean(node.cluster_by_ot ?? d.clusterByOt),
    viewMode: oneOf(node.view_mode, HANDOVER_VIEW_MODES, d.viewMode),
  };
}

export function handoverSettingsToNode(s: HandoverSettings): Partial<GridStackWidget> {
  return {
    method: s.method,
    resource_types: s.resourceTypes,
    businessobject_types: s.businessObjectTypes,
    case_type: s.caseType,
    flat_resource_type: s.flatResourceType,
    max_gap: s.maxGap,
    normalization: s.normalization,
    normalization_scope: s.normalizationScope,
    parallel_filter_enabled: s.parallelFilterEnabled,
    parallel_threshold: s.parallelThreshold,
    min_parallel_observations: s.minParallelObservations,
    cluster_by_ot: s.clusterByOt,
    view_mode: s.viewMode,
  };
}

/** The persisted (snake_case) fields of the resource profiling widget. */
export type ResourceProfilingWidgetFields = {
  resource_types?: string[];
  business_object_types?: string[];
  feature_groups?: string[];
  tooltip_feature_groups?: string[];
  compute_clusters?: boolean;
  cluster_method?: ProfilingClusterMethod;
  n_clusters?: number;
  min_cluster_size?: number;
  distance_metric?: ProfilingDistanceMetric;
  view_mode?: HandoverViewMode | ProfilingViewMode;
};

function featureGroupList(value: unknown): FeatureGroup[] {
  return stringList(value).filter((g): g is FeatureGroup => (FEATURE_GROUPS as string[]).includes(g));
}

export function profilingSettingsFromNode(node: ResourceProfilingWidgetFields): ResourceProfilingSettings {
  const d = DEFAULT_PROFILING_SETTINGS;
  const featureGroups = featureGroupList(node.feature_groups);
  const groups = featureGroups.length > 0 ? featureGroups : d.featureGroups;
  return {
    resourceTypes: stringList(node.resource_types),
    businessObjectTypes: stringList(node.business_object_types),
    featureGroups: groups,
    tooltipFeatureGroups: featureGroupList(node.tooltip_feature_groups).filter((g) => !groups.includes(g)),
    computeClusters: Boolean(node.compute_clusters ?? d.computeClusters),
    clusterMethod: oneOf(node.cluster_method, PROFILING_CLUSTER_METHODS, d.clusterMethod),
    nClusters: Math.max(1, Math.round(finiteNumber(node.n_clusters, d.nClusters))),
    minClusterSize: Math.max(2, Math.round(finiteNumber(node.min_cluster_size, d.minClusterSize))),
    distanceMetric: oneOf(node.distance_metric, PROFILING_DISTANCE_METRICS, d.distanceMetric),
    viewMode: oneOf(node.view_mode, PROFILING_VIEW_MODES, d.viewMode),
  };
}

export function profilingSettingsToNode(s: ResourceProfilingSettings): Partial<GridStackWidget> {
  return {
    resource_types: s.resourceTypes,
    business_object_types: s.businessObjectTypes,
    feature_groups: s.featureGroups,
    tooltip_feature_groups: s.tooltipFeatureGroups,
    compute_clusters: s.computeClusters,
    cluster_method: s.clusterMethod,
    n_clusters: s.nClusters,
    min_cluster_size: s.minClusterSize,
    distance_metric: s.distanceMetric,
    view_mode: s.viewMode,
  };
}
