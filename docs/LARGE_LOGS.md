# Working with large event logs

Logs in the millions of events (for example the *Age of Empires* OCEL 2.0 log,
2.4 M events / 362 K objects) are supported end to end. This page describes
the three mechanisms that make that workable and how to build on them.

## 1. Import pipeline (`totem_lib/src/totem_lib/ocel/importer_db.py`)

Every upload is converted once into the internal DuckDB format. All source
formats go through the same three steps:

1. **Stage.** Raw source rows land in DuckDB temp tables (`_src_*`), as close
   to the source layout as possible (raw timestamp strings, attributes in
   long `(owner, name, value)` form). DuckDB does the heavy lifting:
   - **SQLite** is read with the `sqlite_scanner` extension in pure SQL.
     The extension is loaded from DuckDB's extension directory, or from the
     optional `duckdb-extension-sqlite-scanner` pip package when the machine
     is offline (its version must match the installed `duckdb`). Without
     either, a chunked `sqlite3` → Arrow fallback is used (roughly 25 %
     slower, no extra dependency).
   - **JSON** below `streaming_threshold_mb` (200 MB) is read by DuckDB's
     native JSON reader; larger files are streamed with `ijson` in Arrow
     batches so memory stays bounded.
   - **XML** is streamed with `ElementTree.iterparse` in Arrow batches.
   - **CSV** is streamed with `csv.DictReader` in Arrow batches.
2. **Finalize.** Pure SQL parses timestamps (`TRY_CAST`, with the Python
   parser as a fallback for exotic formats such as JavaScript date strings),
   drops duplicates deterministically (first occurrence wins), filters
   dangling references at insert time and pivots object attribute snapshots
   into `objects` (latest value) and `object_attribute_history`.
3. **Index + validate.** Indexes are built after the load (far cheaper than
   maintaining them row by row); strict mode then runs the OCEL validation.

Reference timings on a 4-core container for the 2.4 M-event synthetic log:
SQLite (726 MB) ≈ 70 s, streamed JSON (1.2 GB) ≈ 110 s, XML (940 MB) ≈ 130 s.
The previous row-by-row path needed about 15 ms per event (hours for this
log).

`import_ocel_db(..., progress=callback)` reports `(fraction, message)` as the
import advances; the upload endpoint forwards it to the client (see below).

## 2. Automatic time-range filter for large logs

When a log with more than `LARGE_LOG_EVENT_LIMIT` (40 000) events is
selected, the frontend applies a global **time-range filter** covering the
first 40 000 events before the overview mounts, so no view starts computing
over the whole log. The rule appears in the filter bar like any other filter
and can be adjusted or removed; it is proposed once per log and browser
session (`sessionStorage`).

- Backend: `GET /api/files/<id>/suggested_time_window/?max_events=40000`
  returns `{needed, total_events, max_events, selected_events, after,
  before}`. For the default limit the window is computed when the log is
  loaded and served without waiting for the per-file algorithm lock.
- Frontend: `prepareLargeLogFilter(fileId)` in
  `frontend/src/store/applyGlobalFilter.ts` (called on file selection,
  project switch and after upload); `FilterChipStack` has a fallback for
  other entry points.

The filter shadow (`_filter_shadow` in `backend/api/views/_ocel_db.py`)
applies the cheap event-level predicates first, so a narrow window over a
huge log never copies the whole relation table.

## 3. Cancellable computations with progress (`backend/api/jobs.py`)

Every request to a heavy endpoint can be followed and stopped:

1. The client sends a job id in the `X-Totem-Job-Id` header (the axios
   interceptor in `frontend/src/interceptors/axios.js` does this for every
   analysis endpoint and registers the request in
   `frontend/src/store/computationStore.ts`).
2. The view wraps its work in `job_scope(request, label)` and passes the job
   to `_with_ocel_db(user_file, job)` and `job.report` as the algorithm's
   `progress` callback.
3. `GET /api/jobs/?ids=a,b` returns `{id: {status, fraction, message,
   elapsed_s, label}}`; `POST /api/jobs/<id>/cancel/` stops a job. Cancelling
   interrupts the DuckDB statement that is running (and any that start
   afterwards), and the progress callback raises `JobCancelled`, which the
   view answers with **HTTP 499** and `{"code": "cancelled"}`.
4. Aborting the HTTP request on the client (component unmount, filter
   change) also cancels the job on the backend, so an abandoned computation
   does not block the per-file lock for the next request.

The registry is process-local; progress and cancel flags are mirrored through
the shared file cache so multi-worker deployments still find a job served by
another worker.

Algorithms report progress through `totem_lib.progress.Progress`
(`report(fraction, message)`, `sub(lo, hi)` for phases). Currently
instrumented: OC-DFG, TOTeM discovery and conformance, process-area
preparation, OCCN discovery, variant discovery, OCPN discovery and the
import. Endpoints without fine-grained progress show an indeterminate bar
with the current phase.

UI: the floating **computation panel** (bottom right) lists every running
computation with its progress and a Cancel button; the main visualizers show
the same status inline while loading.
