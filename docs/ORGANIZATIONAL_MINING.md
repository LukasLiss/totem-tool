# Organizational Mining

Two analysis components look at *who* does the work in an object-centric
event log:

* **Handover of Work** — which resources pass business objects to each other,
  how often, and how fast (`totem_lib.ochandover.OCHANDOVER`).
* **Resource Profiling** — a feature profile per resource (activities,
  co-occurrence, object collaboration, object portfolio, time of day, weekday),
  distances, clustering into organizational units and an MDS layout
  (`totem_lib.ochandover.ProfileMatrix`).

Both live under *Analysis → Organizational Mining* in the sidebar and are
available as dashboard widgets.

## Data access

The algorithms read the log through `totem_lib.ochandover.EventObjectSource`,
which describes the one slice they need: one row per (event, object) pair for
the object types under study, plus the type of every such object. It can be
built from the polars `ObjectCentricEventLog` (`from_ocel`) or — the path the
backend uses — with one SQL query over the relational `events` /
`event_object` / `objects` tables of an `OcelDuckDB` (`from_ocel_db`). Only the
requested object types are read. Because the query names the tables
unqualified, a backend filter shadow (`_filter_shadow`) is honoured, so the
global filter applies to both analyses.

Library entry points:

| Polars log | DuckDB log |
|---|---|
| `OCHANDOVER.from_ocel(ocel, resource_types, businessobject_types, ...)` | `OCHANDOVER.from_ocel_db(db, ...)` |
| `OCHANDOVER.from_ocel_flattened(ocel, case_type, resource_type, ...)` | `OCHANDOVER.from_ocel_db_flattened(db, ...)` |
| `OCHANDOVER.compute_footprint(ocel, object_types)` | `OCHANDOVER.compute_footprint_db(db, object_types)` |
| `ProfileMatrix.from_ocel(ocel, ...)` | `ProfileMatrix.from_ocel_db(db, ...)` |

`totem_lib/tests/ochandover/test_db_parity.py` asserts that both paths give
identical results.

## Endpoints (`backend/api/views/ochandover.py`)

All three resolve the log through `_with_ocel_db`, run under `_filter_shadow`
and cache their result in the results cache keyed by parameters and filter.

| Route | Purpose |
|---|---|
| `GET/POST /api/handover/` | Handover graph. `file_id`, `method` (`oc` \| `flattened`), `resource_types`, `businessobject_types` (comma-separated) or `case_type` + `resource_type`, `max_gap`, `normalization`, `normalization_scope`, `parallel_threshold`, `min_parallel_observations`, `cluster_by_ot`, `include_flows`, `include_bindings`. `POST` additionally takes a JSON `cluster_map` (`{resource: cluster}`) that collapses resources into organizational units. |
| `GET /api/profile-matrix/` | Resource profiles. `file_id`, `resource_types`, `business_object_types`, `feature_groups`, `tooltip_feature_groups`, `width` + `height` (MDS canvas), `compute_clusters`, `cluster_method` (`kmeans` \| `agglomerative` \| `hdbscan`), `n_clusters`, `min_cluster_size`, `distance_metric` (`euclidean` \| `hellinger`). |
| `GET /api/event-log/` | The (filtered) log as a flat table, one row per event with its objects grouped by type; timestamps in Unix milliseconds. Optional `limit`; `total_events` always reports the full count. |

Global filter parameters (`object_types`, `activities`, `after`, `before`)
are read from the query string, where the frontend's axios interceptor puts
them; the three routes are registered as data endpoints there.

## Dashboard widgets

`OCHandoverComponent` and `ResourceProfilingComponent` (`backend/api/models.py`,
frontend `components/OrgaMiningComponents.tsx`) persist:

* `show_controls` — whether the explorer's settings panel is shown in the
  dashboard's **view mode**. Off, the widget shows only the result (and a
  compute button when it has not run yet).
* `automatic_loading` — start the computation with the preselected settings
  when the dashboard opens.
* the preselected settings of the explorer (object types, method,
  normalization, parallel filter, feature groups, clustering, default view;
  see `react_component/orgamining/settings.ts` for the mapping between the
  persisted snake_case fields and the explorer settings).

In edit mode the widget shows a settings card with those switches and the
preselection controls; in view mode it hosts the explorer with the persisted
settings. Layout saves validate choices and clamp numeric ranges server-side
(`api/views/dashboards.py`).

Clusters found by a resource profiling explorer are shared with handover
explorers through `store/clusterStore.ts` (a zustand store, so it also works
across the separate React roots GridStack renders dashboard widgets into).
