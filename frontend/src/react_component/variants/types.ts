/* ============================
   Types shared by the Variants Explorer, its settings panel and the
   dashboard wrapper. The extraction / iso aliases must mirror
   totem_lib.variants.ocvariants_db.{Extraction,IsoStrategy} and the backend's
   api.variant_params.
   ============================ */

export type Extraction = "leading_1hop" | "leading_bfs" | "connected" | "resource_aware";
export type IsoStrategy =
  | "db_signature" | "trace" | "signature" | "wl" | "wl+vf2" | "exact";

export const RESOURCE_AWARE_EXTRACTION: Extraction = "resource_aware";
export const LEADING_EXTRACTIONS: Extraction[] = ["leading_1hop", "leading_bfs"];

export type OptionInfo<T extends string> = { value: T; label: string; hint: string };

export const EXTRACTION_OPTIONS: OptionInfo<Extraction>[] = [
  { value: "leading_1hop", label: "Leading type — 1-hop", hint: "One execution per object of the leading type plus its direct neighbours. Fast, default." },
  { value: "leading_bfs",  label: "Leading type — BFS",   hint: "Paper-faithful breadth-first search from each leading object. Slower." },
  { value: "connected",    label: "Connected components", hint: "One execution per connected component of the object graph. No leading type." },
  { value: "resource_aware", label: "Resource-aware", hint: "Business objects and activities define the executions; shared resources (workers, machines) never merge them." },
];

export const ISO_OPTIONS: OptionInfo<IsoStrategy>[] = [
  { value: "db_signature", label: "SQL signature",      hint: "Cheapest. May over-merge." },
  { value: "trace",        label: "Trace",              hint: "Linearisation-sensitive." },
  { value: "signature",    label: "Python signature",   hint: "Topology-blind multiset." },
  { value: "wl",           label: "WL hash",            hint: "Sound on real OCEL data." },
  { value: "wl+vf2",       label: "WL + VF2",           hint: "Recommended default." },
  { value: "exact",        label: "Exact (slow)",       hint: "Full pairwise VF2." },
];

/** Everything that decides how process executions are cut out of the log. */
export type ExecutionSettings = {
  extraction: Extraction;
  leadingType: string;
  businessObjectTypes: string[];
  businessActivities: string[];
};

/** How executions are grouped into variants. */
export type GroupingSettings = {
  iso: IsoStrategy;
  timeoutS: number;
};

/** Optional materialisation of executions (and variants) into the log. */
export type StoreSettings = {
  enabled: boolean;
  executionColumn: string;
  computeVariants: boolean;
  storeVariantColumn: boolean;
  variantColumn: string;
};

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  enabled: false,
  executionColumn: "process execution",
  computeVariants: true,
  storeVariantColumn: false,
  variantColumn: "variant",
};

/** The settings a dashboard persists for a Variants component. */
export type AdvancedSettings = {
  extraction: Extraction;
  iso: IsoStrategy;
  timeout_s: number;
  leading_type: string;
  business_object_types: string[];
  business_activities: string[];
};

/* =========================
   Backend payload shapes
   ========================= */
export type VariantObject = {
  id: string;
  type: string;
  label?: string;
};

export type VariantEventNode = {
  id: string;
  activity: string;
  objectIds: string[];
  types: string[];
  x: number;
  y_lane: number;
  y_lanes: number[];
};

export type VariantGraph = {
  nodes: VariantEventNode[];
  edges: { from: string; to: string }[];
  objects: VariantObject[];
};

export type Variant = {
  id: string | number;
  support: number;
  signature: string;
  signature_hash: string;
  /** Ids of the process executions grouped into this variant. */
  case_ids?: string[];
  graph: VariantGraph;
};

export type VariantsResponse = {
  variants: Variant[];
  object_types: string[];
  extraction?: Extraction;
  leading_type?: string | null;
  business_object_types?: string[];
  business_activities?: string[] | null;
};

/** Response of `POST /api/files/{id}/process_executions/`. */
export type StoredExecutionsResponse = {
  file_id: number;
  extraction: Extraction;
  leading_type: string | null;
  business_object_types: string[];
  business_activities: string[] | null;
  execution_column: string;
  variant_column: string | null;
  execution_count: number;
  total_event_count: number;
  assigned_event_count: number;
  ambiguous_event_count: number;
  unassigned_event_count: number;
  variant_count: number | null;
  variants: Variant[] | null;
  object_types: string[];
};
