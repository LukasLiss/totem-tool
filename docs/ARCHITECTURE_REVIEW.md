# Codebase Architecture Review

*Scope: full repository (backend, totem_lib, frontend, electron, CI/packaging). Inspection and measurement only — no functional changes. All findings verified against the code at the commit this document was added; benchmark numbers were measured on the bundled `ContainerLogistics` sample logs (35,413 events).*

---

## TL;DR — what matters most

| # | Finding | Severity | Area |
|---|---------|----------|------|
| 1 | The DuckDB transition still holds the **entire log in RAM**: `import_ocel_db()` defaults to `:memory:` and the backend never persists the converted DB | Critical | Performance / big logs |
| 2 | The **streaming import path is ~300× slower than bulk** (measured: 1.1s vs 325s on the same 10 MB file) — and it is the path chosen for files ≥ 200 MB, i.e. exactly the "too big for RAM" case | Critical | Performance / big logs |
| 3 | `OcelDuckDB.save()`/`load()` **silently drops all indexes and constraints** (measured: 5 indexes before, 0 after) | High | Performance / big logs |
| 4 | **Unauthenticated IDOR**: `OCDFGViewSet` and `NewOCDFGViewSet` are `AllowAny` and fetch `EventLog.objects.get(id=file_id)` without user scoping | Critical | Security |
| 5 | `DEBUG=True`, hardcoded `SECRET_KEY`, `CORS_ORIGIN_ALLOW_ALL` + credentials, and a **superuser Guest fixture with a known password** — all committed | Critical | Security / self-hosting |
| 6 | **pm4py is AGPL-3.0 and cvxopt is GPL-3.0** while the repo claims MIT — a legal blocker for closed enterprise distribution | Critical | Licensing |
| 7 | The PyInstaller spec bundles almost none of the app (no hidden imports for `api`, `totem_lib`, polars, duckdb, pyarrow, pm4py…), and the packaged app writes its SQLite DB and uploads into the **read-only install directory** | Critical | Executable |
| 8 | The frontend hardcodes `http://localhost:8000` in 25 places across 16 files — remote self-hosting is impossible without a refactor | High | Self-hosting |
| 9 | The per-worker DuckDB registry **never evicts** connections (not even when the EventLog is deleted) and is per-process — memory grows monotonically and multiplies by gunicorn worker count | High | Performance / ops |
| 10 | ~4,600 lines (~12%) of the frontend are dead or copy-pasted duplicates; `views.py` carries ~1,000 lines of mock literals inside live view functions | Medium | Maintainability |

The good news: the direction is right, and the hardest part is already working. The DuckDB-backed algorithm implementations (`totem_db.py`, `ocdfg_db.py`, `oc_dotted_chart_db.py`) push computation into SQL correctly, the totem_lib test suite is genuinely good (261 tests passing, streaming/bulk importers cross-checked against the Polars reference), and the Django-layer concurrency handling around DuckDB connections is carefully reasoned. Once data is in DuckDB, the algorithms are fast: `find_variants` (wl+vf2) 0.44s and `totemDiscovery_db` 0.37s on the 35k-event sample. What's missing is the *lifecycle* around DuckDB — import speed, on-disk persistence, connection management — plus the productization layer (security config, packaging, deployment).

---

## 1. The DuckDB transition (deep dive)

### 1.1 What is already good

- **Clear architectural commitment.** `backend/api/views.py:11-21` documents DuckDB-first; every UI-wired endpoint operates on `OcelDuckDB`. The Polars `ObjectCentricEventLog` is no longer constructed on the web path.
- **Correct compute-in-SQL pattern where it counts.** `totem_db.py` computes event/log cardinalities and temporal relations entirely in SQL and only pulls per-type aggregates into Python. `ocdfg_db.py` uses window functions (`LAG`/`LEAD` over per-object partitions) and returns grouped counts. `oc_dotted_chart_db.py` does server-side sampling with explicit point budgets (`DEFAULT_MAX_POINTS = 3_000`, `HARD_MAX_POINTS = 20_000`) — this is the model the rest of the system should follow.
- **Thoughtful in-process concurrency.** The registry in `views.py:677-743` correctly identifies that DuckDB connections can't go in Django's cache (unpicklable native handle), that connection-scoped TEMP tables make concurrent queries on one connection dangerous, and solves it with per-file locks + double-checked loading.
- **Fast bulk import.** Measured: 10.2 MB JSON → 1.09s; the SQLite bulk path is a pure-SQL `ATTACH` pipeline with no Python row iteration.
- **Solid test discipline in totem_lib** — 261 tests pass, including correctness cross-checks of DB-backed algorithms against the Polars reference implementations and importer equivalence tests.

### 1.2 Critical gap: the whole log still lives in RAM

`import_ocel_db(file_path, db_path=":memory:")` (`importer_db.py:38-41`) defaults to an **in-memory** DuckDB, and the backend's `_build_ocel_db_from_path()` (`views.py:663-674`) never passes a `db_path`. So for every upload format except native `.duckdb`, the *entire converted log* is materialized in worker RAM and pinned there forever by the registry. The code comment at `views.py:660-661` acknowledges the fix ("persist the converted DuckDB to disk on upload — that's a follow-up") — **that follow-up is the single most important piece of the transition and should be done next.** Until then, the DuckDB migration changes *where* the data sits in RAM but not *whether* it sits in RAM, and files too big for memory will still OOM the worker.

**Recommended design:** convert once at upload time (`import_ocel_db(src, db_path=upload_path + ".duckdb")`), recreate indexes after load, and from then on open the file with `duckdb.connect(path, read_only=True)`. Read-only connections remove the single-writer file lock, which means multiple gunicorn workers *and* multiple concurrent per-request connections can share one file — eliminating both the per-file lock bottleneck and the registry (each request can cheaply open/close, or use a small LRU pool).

### 1.3 Critical gap: the streaming path is unusable at the sizes it targets

Measured on the same machine, same file:

| Path | 10.2 MB JSON | 16.1 MB SQLite |
|------|-------------:|---------------:|
| Bulk | **1.09 s** | n/a (see 1.5) |
| Streaming (`streaming_threshold_mb=0`) | **325 s** | **330 s** |

That is a ~300× slowdown, and streaming is what automatically kicks in for files ≥ 200 MB (`importer_db.py:31,114-116`). Linear extrapolation puts a 200 MB JSON at **~1.8 hours** and a 1 GB file at most of a workday — for the exact use case ("files too big for RAM") the transition is meant to serve. Causes, in rough order of impact:

1. **`conn.executemany()` row-by-row inserts** (`_flush`/`_flush_ignore`, `importer_db.py:1471-1491`). DuckDB's Python `executemany` re-binds and executes per row; DuckDB's own docs recommend Arrow/DataFrame registration or `COPY` for bulk loads. The bulk path already does this right (`_bulk_insert` registers a Polars frame and does `INSERT … SELECT`). **Fix: accumulate batches into Polars DataFrames (bounded, e.g. 50k rows) and reuse `_bulk_insert` per batch.** This alone should recover most of the 300×.
2. **Indexes and primary keys are created *before* the load** (`create_ocel_schema`, `ocel_duckdb.py:28-78`). Every insert pays ART-index maintenance and PK-uniqueness checks. Standard practice: create indexes after data load; for graceful dedup use post-load `DELETE`/`DISTINCT` (a `_graceful_cleanup` pass already exists).
3. **The JSON file is fully parsed 4× with pure-Python ijson** (two discovery passes at `importer_db.py:1012-1024`, then two data passes). Attribute-column discovery for events and objects can share one pass, and `ijson`'s C backend (`yajl2_c`) is a drop-in speedup.

Also note: the *bulk* JSON/XML paths do `json.load`/`ET.parse` of the whole file (`importer_db.py:370-372,512`), so peak import RAM for a 199 MB file is several × file size. Fixing streaming throughput matters more than tuning the threshold.

### 1.4 Streaming is not actually bounded-memory

The module docstring claims "the full dataset never lives in RAM simultaneously," but:

- `_sqlite_insert_objects` accumulates `latest_attrs` (every object) and `snapshot_map` (every object × timestamp) in Python dicts (`importer_db.py:925-953`), and `history_rows` is flushed once at the end rather than per batch.
- `_sqlite_insert_events` keeps a `seen_events` set of all event IDs (`importer_db.py:882`).
- The `_import_json` object pass keeps per-object snapshot maps and never bounds `hist_rows` flushing between objects the way it bounds events.

For logs whose *object* population is large (typical of OCEL), the streaming path still scales RAM with the log. These accumulations exist to compute "latest attribute per object" — that is a `ROW_NUMBER() OVER (PARTITION BY obj_id ORDER BY ts DESC)` query DuckDB can run after loading raw snapshots into a table. Push it into SQL and the Python-side state disappears.

### 1.5 The SQLite bulk path requires a runtime extension download

`_import_sqlite_bulk` executes `ATTACH … (TYPE sqlite)` (`importer_db.py:213-214`), which makes DuckDB auto-download `sqlite_scanner` from `extensions.duckdb.org` on first use. In this review's sandboxed environment that download failed (HTTP 403 through the egress proxy) and **the import of a plain `.sqlite` OCEL file errored out**. The same will happen on air-gapped enterprise servers, behind restrictive proxies, and inside a packaged Electron app on a machine without internet. Fixes: ship the extension with the app (`duckdb.install_extension` at build time / bundle the `.duckdb_extension` file and `SET extension_directory`), or fall back to the Python-sqlite3 streaming reader when the extension is unavailable (the fallback exists but is only selected by file size, not by capability — and it's currently 300× slower, see 1.3).

### 1.6 `save()`/`load()` silently produce an unindexed database

Verified empirically: after `import_ocel_db(...)` the DB has 5 indexes; after `db.save(path)` + `OcelDuckDB.load(path)` it has **zero indexes and zero PK constraints**, because `save()` copies via `CREATE TABLE _save_dest.t AS SELECT …` (`ocel_duckdb.py:371-382`), which does not carry DDL. Every workflow the docstrings recommend ("first run slow, every subsequent run fast", `ocel_duckdb.py:393-401`) yields a database whose joins full-scan. Fix: re-run the index DDL inside `load()` (or after the copy loop in `save()`), or use `COPY FROM DATABASE` semantics. Additionally, `load()` opens read-write (`duckdb.connect(db_path)`, `ocel_duckdb.py:410`) — DuckDB allows only one read-write process per file, so a second gunicorn worker touching the same uploaded `.duckdb` will fail to attach. Analysis connections should be `read_only=True`.

### 1.7 Registry lifecycle: unbounded growth, leaks on delete, per-worker duplication

- `_OCEL_DB_REGISTRY` and `_OCEL_DB_LOCKS` (`views.py:701-703`) are only ever inserted into — never popped. Comment at `views.py:697-698`: "no TTL — the connection stays open until the process exits."
- `api/signals.py` deletes the file on `EventLog` post-delete but never closes/evicts the registry entry → the in-memory DuckDB (i.e., the whole log) leaks after deletion.
- Both the registry and the derived-result cache (Django default = `LocMemCache`; no `CACHES` in settings) are **per-process**. Under `gunicorn -w N` everything is duplicated N× and the per-file `threading.Lock` no longer protects anything across workers.
- `cache.delete` is never called anywhere — `totem_discovery_{pk}`/`mlpa_discovery_{pk}` entries only expire by TTL.
- Every upload creates a brand-new `Project` (`views.py:215-225`), so re-uploads orphan the old file's registry entry and grow the Project table unboundedly.

Fix (mostly falls out of §1.2's design): persist-to-disk + read-only per-request connections make the registry unnecessary; if a pool is kept, give it LRU eviction and wire eviction into `EventLog` deletion.

### 1.8 The default variants path still materializes everything in Python

`find_variants` does case extraction and edge derivation in SQL (good — the `case_edges` CTE in `ocvariants_db.py:106-129` is the right idea), but with the default `iso="wl+vf2"`:

- `build_object_graph()` (`variants/extraction.py:27-43`) fetches **every co-occurring object pair** and builds a full NetworkX graph of all objects. The self-join is quadratic in objects-per-event, and the graph lives in Python RAM.
- `_build_case_graphs()` (`ocvariants_db.py:431-466`) fetches all nodes and edges of **all cases** and builds one `nx.DiGraph` per case.
- `_fetch_case_event_lists()` pulls every (case, event) pair into a dict.

Only the `db_signature` and `trace` strategies stay in SQL. For genuinely large logs, the variants feature will be the first to blow memory even after the import problems are fixed. Options: default the API to `db_signature`/`trace` with WL/VF2 as opt-in refinement; run WL bucketing on SQL-computed signatures so only one representative graph per bucket is ever materialized; and stream case graphs bucket-by-bucket rather than all at once. Also, the Django `variants` endpoint returns **all** variants with full layouts in one response (`views.py:901-1033`) and the frontend renders all of them (see §4) — pagination belongs in the API contract.

Minor library issues worth cleaning up along the way: `tqdm` progress bars print from library code into server logs (`ocvariants_db.py` throughout); `OcelDuckDB.save()` interpolates the path into `ATTACH '{db_path}'` unescaped (`ocel_duckdb.py:371`); the legacy `OcelDuckDB(ocel)` constructor inserts row-by-row in Python instead of registering the Polars frames it already has (`ocel_duckdb.py:160-258`).

---

## 2. Bad architecture decisions

### Backend

- **`views.py` is a 2,303-line monolith** mixing HTTP handling, DuckDB connection lifecycle, JSON serialization adapters (`_serialize_totem`, `_serialize_mlpa`), dashboard persistence, and — worst — **~1,000 lines of hardcoded mock graph literals inside the live `OCDFGViewSet` function body** (`views.py:1044-2124`). Split into `services/` (OCEL lifecycle), `serializers`, and per-domain view modules; delete the mocks or move them to fixtures.
- **The file-lookup/authorization/OCEL-load boilerplate is copy-pasted 9× with three different idioms**: `get_queryset().get(pk=pk)` + 404 (7 endpoints), `EventLog.objects.get(pk, project__users=user)` + a 400 that leaks the absolute server path (`views.py:915-917`), and unscoped `EventLog.objects.get(id=file_id)` (the two IDOR endpoints). One `get_user_eventlog_or_404()` helper fixes consistency and the security hole at once.
- **Multi-table inheritance + hand-maintained dispatch for dashboard components.** Each of the 9 `DashboardComponent` subclasses is a separate joined table; `get_layout` does one extra query per component (N+1, `views.py:446-465`), and the `if/elif` type ladder is duplicated between `get_layout` and `save_layout` — with a real bug: `save_layout` matches `'NumberOfEventsComponent'` (capital O) while `get_layout` and the model use `'NumberofEventsComponent'`, so that component's `color` is silently dropped on reload. `django-rest-polymorphic` is already a dependency and would replace the ladders. `save_layout` also does `delete()`-then-recreate with **no `transaction.atomic`** — a mid-loop failure wipes the dashboard.
- **Business logic in the HTTP layer**: variant signature hashing and node-shape mapping in the `variants` view (`views.py:994-1028`), and `_layout_shim` (`views.py:761-772`) papering over a totem_lib API gap. Both belong in totem_lib (the newer `NewOCDFGViewSet` shows the right pattern — it delegates everything to `NewOCDFGDb`).

### totem_lib

- **Two full algorithm stacks + three importers.** Polars stack (`ocel.py`, `importer.py`, `ocvariants.py`, `totem.py`, `ocdfg.py`) and DuckDB stack (`ocel_duckdb.py`, `importer_db.py`, `ocvariants_db.py`, `totem_db.py`, `ocdfg_db.py`), plus `importer_duckdb.py` (`.duckdb` → Polars round-trip). The Polars stack legitimately serves as the correctness oracle in tests and is required by OCCN/OCPN (not UI-wired), but every algorithm change currently must be made twice. Decide explicitly: either the Polars stack is a frozen test oracle (document that, stop extending it) or migrate OCCN/OCPN and retire it.

### Frontend

- **No server-state layer.** Every component hand-rolls `useState` + `useEffect` + `AbortController` + stale-closure guards; no caching, so every view switch refetches. React Query/SWR would delete hundreds of lines and fix the refetch churn.
- **No API base configuration**: 25 hardcoded `http://localhost:8000` / `http://127.0.0.1:8000` URLs across 16 files; the `src/api/` layer exists but most calls bypass it; auth is bolted onto global axios defaults; JWTs live in `localStorage` (XSS-readable); guest credentials `"Guest"/"guest"` are hardcoded in three places.
- **`TotemVisualizer.tsx` is a 6,339-line god component**: ~50 type definitions, a complete custom edge-routing engine (spatial index, obstacle avoidance, S-curve generation), and a 25-`useState` view all in one file. The geometry/routing engine is pure logic that should be plain modules with unit tests.
- **No code splitting** — zero `React.lazy`; the 6.3k-line Totem visualizer, both ~1,200-line OCDFG duplicates, and 1,399 lines of dead visualizer all ship in one bundle.

---

## 3. Duplicated logic and dead code

### Frontend (~4,600 lines ≈ 12% of src is dead or duplicated)

Dead (zero importers — safe to delete):

| File | Lines | Note |
|---|---:|---|
| `react_component/OCDFGLongestTraceVisualizer.tsx` | 957 | fully dead |
| `components/grid_dev.tsx` | 145 | ~90% copy of `grid.tsx` |
| `mocks/ocdfgDetailMock.ts` | 133 | dead mock |
| `VariantsOverview_new.tsx` | 82 | dead — ironically the *better* implementation (relative URLs, proper loading states) than the routed `VariantsOverview.tsx` |
| `gridstack/lib/sidepanel copy.tsx` | 71 | stale snapshot, note the filename |
| `components/dashboard_view.tsx` | 21 | placeholder stub |

Runtime-dead: `OCDFGVisualizer.tsx` (1,399 lines) — imported in `componentMap.tsx:27` but never rendered (the "VIEW MODE" branch renders `NewOCDFGVisualizer`); everyone else imports only its types. Extract the ~50 lines of types and delete the rest, which also frees `OcdfgEdge.tsx` (783 lines, 92% identical to `NewOcdfgEdge.tsx`).

Live duplication: `NewOCDFGVisualizer.tsx` (1,224) vs `NewOCDFGVariantsVisualizer.tsx` (1,226) differ by only ~148 lines total — **~94% byte-identical**. Merge behind a `variant` prop (the `OCDFGDetailVisualizer` wrapper already demonstrates this pattern).

### Backend

- ~1,000 lines of mock literals in `views.py` (see §2), plus `TOTEM_MOCK`/`TOTEM_MOCK_2` at the top of the file, a `discover_totem_mock` endpoint, and dead code after `return` in `rename` (`views.py:437-438`).
- **Two independent Guest-seeding mechanisms that disagree on privileges**: the migration creates a *regular* user `Guest`/`guest` and re-resets the password on every migrate; `initial_user.json` seeds the same Guest as **`is_superuser: true, is_staff: true`**. Keep exactly one, non-superuser, and only in `LOCAL_MODE`.
- `add_dashboard_components.py` is a broken throwaway script (bad import path, references fields that don't exist).

---

## 4. Performance bottlenecks for bigger event logs

Beyond the import/lifecycle issues in §1 (which dominate):

1. **Variants: unpaginated end-to-end.** The API returns every variant with a full layout in one response; `VariantsExplorer.tsx` fetches all of them, sorts in memory, and renders every row as a full CSS-grid graph — no `limit/offset`, no virtualization (no react-window/virtuoso). Hundreds of variants → thousands of DOM-heavy rows.
2. **OCDFG endpoints return the full graph and the frontend runs ELK layout client-side** on every load. Fine for medium graphs; consider server-side layout caching keyed on (file, filter) for large ones.
3. **The per-file lock serializes all requests for a file** (`views.py:728-743`). The dashboard fires four endpoints in parallel on load; they queue behind each other. With read-only on-disk DuckDB (§1.2) each request can have its own connection and this lock disappears.
4. **`get_layout` N+1** (§2) — trivial but on every dashboard load.
5. **No throttling / backpressure** on compute-heavy endpoints: a handful of concurrent requests for *different* large files each trigger a full import into worker RAM with no cap.
6. **Dotted chart is the positive example** — server-side sampling, viewport filters, capped budgets, debounced refetch. Use it as the template for variants and OCDFG.

Measured reference points (ContainerLogistics, 35,413 events / 74,272 e2o rows): bulk import 1.09s; `find_variants` (leading_1hop, wl+vf2) 0.44s; `totemDiscovery_db` 0.37s. The SQL algorithms are not the problem.

---

## 5. Maintainability issues

- **Test coverage is inverted relative to risk.** totem_lib: 261 passing tests, well organized. Backend: a 3-line stub — zero coverage of auth, permissions (the IDOR would be caught by one test), layout round-trip (the casing bug likewise), or registry concurrency. Frontend: zero tests; `vitest` is installed but there's no test script or config.
- **TypeScript strictness is off** (`strict: false`, `noUnusedLocals: false`), 168 `any`s (129 `as any`), and neither `npm run build` nor CI runs `tsc` (CI uses `build-frontend-no-typecheck`). Dead imports and files go unnoticed because the compiler is never allowed to complain.
- **No logging discipline**: no `LOGGING` config in Django; diagnostics are `print()`/`traceback.print_exc()`; 111 `console.log`s in frontend src; every `except Exception as e` handler interpolates the raw exception into the API response.
- **CI gaps**: `build-and-test.yml` runs totem_lib pytest, backend tests (none exist), and an untype-checked frontend build. `ruff` and eslint exist but are never run in CI. The Electron build workflow is disabled (manual-only), so packaging rot is invisible.
- **Repo hygiene**: `backend/requirements.txt` and `totem_lib/requirements.txt` are **UTF-16LE** files (pip can misparse; diffs are unreadable). Root `.gitignore` globally ignores `*.md`, `*.txt`, and `build/` (which is why the Electron icon is missing from the repo). Two parallel `0011_*` migrations reconciled by an empty merge migration. `totem_lib/pyproject.toml` still says "Example Author / author@example.com". Docs drift: `BUILD_GUIDE.md` describes a pre-PyInstaller flow and claims users need Python; `SETUP.md` says `venv` while Electron dev mode expects `.venv`.

---

## 6. What's missing to ship

### 6.1 As a desktop executable (Electron)

The Electron shell itself (`electron/main.js`) is reasonably built — health check, stdout-based readiness, `tree-kill` cleanup, `contextIsolation` on. But the packaged product has blockers:

1. **The frozen backend won't boot.** `totem_backend.spec` analyzes only `manage.py` and adds hidden imports for `rest_framework_simplejwt` alone. Django loads `api`, `authentification`, the URLconf, and (through `api.views`) `totem_lib` → polars, duckdb, pyarrow, pm4py, scipy, matplotlib, cvxopt, networkx, ijson **dynamically** — none are declared, and the native binaries/data of polars/duckdb/pyarrow aren't collected. The separately copied `resources/totem_lib` is never added to the frozen `sys.path`, so it doesn't help. This needs `collect_all`/`collect_submodules` for each Django app and heavy dependency, plus a packaging smoke test in CI (currently the Electron workflow is disabled).
2. **User data goes into the read-only install directory.** `db.sqlite3` is created at build time and shipped inside `resources/backend`; `MEDIA_ROOT` is `BASE_DIR/user_files`. On a real install (Program Files / signed .app) every upload and dashboard save fails on permissions. The backend needs env-configurable DB/media paths and the Electron shell should pass `app.getPath('userData')`.
3. **It ships Django's dev server** (`runserver 8000 --noreload` even in prod, `main.js:39`). Use a bundled production server (e.g. waitress/gunicorn) or at minimum accept the dev server consciously for a local single-user app — but not with `DEBUG=True`.
4. **No code signing/notarization** (SmartScreen/Gatekeeper will block), **no auto-update**, **no Windows installer** (`win.target: "dir"` produces a bare folder), **missing icon** (referenced `build/icon.png` is gitignored away).
5. **Hardcoded ports 8000/5000** with a health check that treats *any* listener on 8000 as "our backend"; DuckDB's sqlite extension download (§1.5) fails offline.

### 6.2 For self-hosting on enterprise servers

There is currently **no server deployment story at all** — no Dockerfile, no compose file, no gunicorn/uwsgi in requirements, no nginx/whitenoise, no env-based settings, no `.env.example`. Concretely required:

1. **Settings hardening**: env-driven `SECRET_KEY`, `DEBUG=False` default, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` (drop `CORS_ORIGIN_ALLOW_ALL` — it's currently combined with `CORS_ALLOW_CREDENTIALS=True`), secure-cookie/HSTS/`SECURE_PROXY_SSL_HEADER` settings, dev/prod settings split.
2. **Close the authorization holes**: user-scope `OCDFGViewSet`/`NewOCDFGViewSet` (`views.py:1035-1037, 2209-2211` — currently `AllowAny` + unscoped lookup = unauthenticated access to any user's data); remove the superuser `initial_user.json` fixture; add DRF throttling on `/token/` and the compute endpoints; stop serving `MEDIA_ROOT` (user uploads) without auth checks.
3. **Production serving**: gunicorn + `STATIC_ROOT`/`collectstatic` + WhiteNoise (or nginx), media serving strategy, Postgres option via `DATABASE_URL` (SQLite's single-writer + the per-worker registry make multi-worker deployments incorrect today — §1.7's redesign is a prerequisite for horizontal scaling).
4. **Frontend deployability**: replace the 25 hardcoded `localhost:8000` URLs with one axios instance using relative `/api` paths (the Vite dev proxy already exists) or `VITE_API_URL`; without this, a browser pointed at `https://totem.company.example` calls the *user's own* localhost.
5. **Upload limits and validation**: `EventLog.file` has no size limit, no extension/content validation at upload time (only at analysis time, after the file is stored), and `Project.name = CharField(max_length=30)` will crash on long filenames (`f"{slugify(file_name)}_{user.username}"`).
6. **Licensing (legal blocker)**: the repo is MIT, but `totem_lib` hard-depends on **pm4py (AGPL-3.0)** and **cvxopt (GPL-3.0)**. AGPL's network clause is triggered by self-hosting for third parties, and both are incompatible with closed distribution. Options: (a) commercial pm4py license + replace cvxopt, (b) distribute under AGPL, or (c) make OCCN/OCPN (the only pm4py/cvxopt consumers, currently not UI-wired) an optional extra so the shipped core is pm4py-free. Decide before any enterprise conversation.
7. **Ops basics**: `LOGGING` config, health endpoint (exists: `health_check`) wired to a container `HEALTHCHECK`, error tracking, and CI that actually gates (backend tests, ruff, eslint, `tsc`, packaging smoke test).

---

## 7. Suggested order of attack

**P0 — before anyone deploys or demos outside the team (days):**
1. Fix the two IDOR endpoints; make `SECRET_KEY`/`DEBUG`/`ALLOWED_HOSTS`/CORS env-driven; delete/downgrade the superuser Guest fixture.
2. Make the licensing decision on pm4py/cvxopt (affects everything downstream).

**P1 — make big logs actually work (1–2 weeks):**
3. Persist converted DuckDB to disk on upload; open analysis connections `read_only=True`; recreate indexes in `save()`/`load()`; add registry eviction (or remove the registry entirely in favor of per-request read-only connections).
4. Rewrite the streaming importer's insert path to batched Arrow/Polars registration and move index creation after load; push the "latest attribute per object" computation into SQL; single-pass ijson discovery.
5. Bundle/pre-install the DuckDB sqlite extension; add a capability fallback.
6. Paginate the variants API; virtualize `VariantsExplorer`.

**P2 — shippability (2–4 weeks):**
7. Fix the PyInstaller spec (collect Django apps + native deps), move user data to `userData`, re-enable the Electron CI build as a smoke test; add installer/signing when distribution is real.
8. Docker + gunicorn + WhiteNoise + settings split + `.env.example` for self-hosting; frontend API base URL refactor (single axios instance, relative paths).

**P3 — code health (ongoing):**
9. Delete the ~4,600 lines of dead/duplicated frontend code; merge the New* visualizer twins; split `TotemVisualizer.tsx`.
10. Split `views.py` (services + serializers + view modules); extract the shared file-lookup helper; fix `save_layout` atomicity + component-name casing bug; fix `get_layout` N+1 via `rest_polymorphic`.
11. Enable TS `strict` + typecheck in CI; add backend tests (auth/permissions/layout round-trip first); wire ruff + eslint into CI; convert requirements files to UTF-8; fix `.gitignore` and doc drift.
