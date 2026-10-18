/**
 * Running computations: progress and cancellation.
 *
 * Every request to a heavy backend endpoint is tagged by the axios request
 * interceptor (see `interceptors/axios.js`) with a client-generated job id
 * (`X-Totem-Job-Id` header) and registered here. While at least one job is
 * running, the store polls `GET /api/jobs/?ids=…` for progress. Cancelling a
 * job aborts the HTTP request and tells the backend to stop computing
 * (`POST /api/jobs/<id>/cancel/`), which also interrupts the running DuckDB
 * statement and frees the per-file lock for the next request.
 *
 * `ComputationPanel` renders every job; `ComputationStatus` renders the jobs
 * of one component inline in its loading state.
 */
import axios from "axios";
import { create } from "zustand";

export type ComputationStatus = "running" | "cancelling";

export type Computation = {
  id: string;
  label: string;
  url: string;
  method: string;
  fileId: number | null;
  startedAt: number;
  /** 0..1, or null while the backend has not reported a fraction. */
  fraction: number | null;
  message: string;
  status: ComputationStatus;
  /** Set when the interceptor created the controller; null when the caller
   *  supplied its own `signal` (then only the backend cancel is possible). */
  controller: AbortController | null;
};

type ComputationStore = {
  jobs: Record<string, Computation>;
  start: (job: Computation) => void;
  update: (id: string, patch: Partial<Computation>) => void;
  finish: (id: string) => void;
  cancel: (id: string) => void;
  cancelAll: () => void;
};

const POLL_INTERVAL_MS = 500;
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function pollProgress() {
  const { jobs, update } = useComputationStore.getState();
  const ids = Object.keys(jobs);
  if (ids.length === 0) {
    stopPolling();
    return;
  }
  try {
    const { data } = await axios.get<Record<string, { status?: string; fraction?: number | null; message?: string }>>(
      "/api/jobs/",
      { params: { ids: ids.join(",") }, _skipGlobalFilter: true, _skipJobTracking: true },
    );
    for (const id of ids) {
      const info = data?.[id];
      if (!info || info.status === "unknown") continue;
      update(id, {
        fraction: typeof info.fraction === "number" ? info.fraction : null,
        message: info.message ?? "",
      });
    }
  } catch {
    /* progress is best-effort; the request itself reports the outcome */
  }
}

function startPolling() {
  if (pollTimer !== null) return;
  pollTimer = setInterval(() => void pollProgress(), POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

export const useComputationStore = create<ComputationStore>((set, get) => ({
  jobs: {},
  start: (job) => {
    set((s) => ({ jobs: { ...s.jobs, [job.id]: job } }));
    startPolling();
  },
  update: (id, patch) =>
    set((s) => {
      const current = s.jobs[id];
      if (!current) return s;
      return { jobs: { ...s.jobs, [id]: { ...current, ...patch } } };
    }),
  finish: (id) =>
    set((s) => {
      if (!(id in s.jobs)) return s;
      const jobs = { ...s.jobs };
      delete jobs[id];
      if (Object.keys(jobs).length === 0) stopPolling();
      return { jobs };
    }),
  cancel: (id) => {
    const job = get().jobs[id];
    if (!job || job.status === "cancelling") return;
    set((s) => ({ jobs: { ...s.jobs, [id]: { ...job, status: "cancelling", message: "Cancelling…" } } }));
    // Tell the backend first so the running statement is interrupted even if
    // the caller owns the request (no controller to abort here).
    axios
      .post(`/api/jobs/${id}/cancel/`, null, { _skipGlobalFilter: true, _skipJobTracking: true })
      .catch(() => {});
    job.controller?.abort();
    // The aborted request settles through the response interceptor, which
    // removes the job. Jobs without a controller leave once the backend
    // answers (HTTP 499); a safety net drops the entry if that never comes.
    setTimeout(() => get().finish(id), 15000);
  },
  cancelAll: () => {
    for (const id of Object.keys(get().jobs)) get().cancel(id);
  },
}));

// ---------------------------------------------------------------------------
// Which requests are computations, and how to name them
// ---------------------------------------------------------------------------

const FILE_ACTIONS: Record<string, string> = {
  discover_totem: "TOTeM discovery",
  discover_mlpa: "Process areas",
  discover_process_areas: "Process areas",
  discover_ocpn: "Petri net discovery",
  statistics: "Log statistics",
  NoE: "Event count",
  apply_filters: "Applying filter",
  oc_dotted_chart: "Dotted chart",
  totem_conformance: "TOTeM conformance",
  occn_conformance: "OCCN conformance",
  occn_replay_unit_detail: "Replay detail",
  process_executions: "Process executions",
  execute_query: "SQL query",
  event_distribution: "Event distribution",
  suggested_time_window: "Choosing time window",
};

const ROOT_ENDPOINTS: Record<string, string> = {
  "new-ocdfg": "Directly-follows graph",
  occn: "Causal net",
  variants: "Variants",
  handover: "Handover of work",
  "profile-matrix": "Resource profiles",
  "event-log": "Event log table",
};

const FILE_ACTION_RE = /\/api\/files\/(\d+)\/([A-Za-z_]+)\/?(?:\?|$)/;
const ROOT_RE = /\/api\/([a-z-]+)\/?(?:\?|$)/;
const UPLOAD_RE = /\/api\/files\/?(?:\?|$)/;

/** The label of a tracked computation, or null when the request is not one. */
export function computationLabel(url: string, method: string | undefined): string | null {
  const m = (method ?? "get").toLowerCase();
  const fileAction = url.match(FILE_ACTION_RE);
  if (fileAction) return FILE_ACTIONS[fileAction[2]] ?? null;
  // The upload (`POST /api/files/`) converts the file on the server, which
  // can take minutes for a large log.
  if (m === "post" && UPLOAD_RE.test(url)) return "Importing event log";
  const root = url.match(ROOT_RE);
  if (root && root[1] in ROOT_ENDPOINTS) return ROOT_ENDPOINTS[root[1]];
  return null;
}

export function computationFileId(url: string, params?: Record<string, unknown>): number | null {
  const fileAction = url.match(FILE_ACTION_RE);
  if (fileAction) return Number(fileAction[1]);
  const fromUrl = url.match(/[?&]file_id=(\d+)/);
  if (fromUrl) return Number(fromUrl[1]);
  const fromParams = params?.file_id;
  if (fromParams != null && Number.isFinite(Number(fromParams))) return Number(fromParams);
  return null;
}

export function newJobId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** True for an error produced by cancelling a computation (locally or on the backend). */
export function isCancelledError(err: unknown): boolean {
  if (axios.isCancel(err)) return true;
  if (err instanceof Error && err.name === "CanceledError") return true;
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { code?: string } | undefined;
    return err.response?.status === 499 || data?.code === "cancelled";
  }
  return false;
}

/** Running jobs for one component: by file and (optionally) endpoint fragment. */
export function selectComputations(
  jobs: Record<string, Computation>,
  options: { fileId?: number | string | null; urlIncludes?: string | string[] },
): Computation[] {
  const fileId = options.fileId == null || options.fileId === "" ? null : Number(options.fileId);
  const fragments = options.urlIncludes == null
    ? []
    : Array.isArray(options.urlIncludes) ? options.urlIncludes : [options.urlIncludes];
  return Object.values(jobs)
    .filter((job) => fileId === null || job.fileId === null || job.fileId === fileId)
    .filter((job) => fragments.length === 0 || fragments.some((f) => job.url.includes(f)))
    .sort((a, b) => a.startedAt - b.startedAt);
}
