# Object-Centric Playout

The playout view ("Playout" in the sidebar, Simulation section) enumerates
every distinct process execution — every *object-centric variant* — that an
OC Petri Net or OC Causal Net allows, for a fixed number of objects per
object type and a maximum number of occurrences per activity ("wide"
playout). The result can be exported as an OCEL 2.0 log in which each
variant is one process execution with its own objects, or as a plain
variants JSON file.

## Architecture

All process-mining logic lives in `totem_lib`; the backend exposes it over
HTTP and the frontend only collects input and visualizes results.

- **`totem_lib.playout`** (`totem_lib/src/totem_lib/playout/`)
  - `ocpn_engine.py` / `occn_engine.py` — state-space engines over the
    editor model JSON (formats in [MODEL_EDITORS.md](MODEL_EDITORS.md)).
    The OCPN engine implements the van der Aalst & Berti token game (typed
    places, variable arcs, silent transitions). The OCCN engine follows the
    obligation semantics of `totem_lib.occn` (marker groups, cardinality
    ranges, marker keys, START/END pseudo activities).
  - `search.py` — depth-first enumeration bounded by per-activity
    occurrence budgets, a wall-clock timeout, and a state cap. In variants
    mode two sound prunings (trace normal form over independent events and
    fresh-object symmetry) skip redundant interleavings/namings without
    losing variants; raw mode counts every binding sequence like
    `totem_lib.occn.playout.occn_playout` (used for parity tests).
  - `canon.py` — canonicalization: executions that only differ by
    reordering independent events or renaming same-type objects map to the
    same variant key, so finished searches yield exact variant counts.
  - `ocel_export.py` — variants → OCEL 2.0 JSON (one disconnected object
    component per variant; deterministic timestamps).
  - `service.py` — `playout_from_model_dict(...)`, the JSON-in/JSON-out
    entry point used by the backend. For OCCNs it limits `START_<type>` /
    `END_<type>` automatically to the number of objects of that type.
- **Backend** (`backend/api/views.py`)
  - `POST /api/playout/` — body `{modelFormat, model, objectsPerType,
    activityLimits, timeoutS, maxStoredVariants?, maxStates?}`; returns the
    variants plus counts and exhaustiveness flags. Hitting the timeout or
    state cap is a normal 200 (`timedOut` / `stateCapHit` / `exhaustive`
    flags); the variant count is then a lower bound. Invalid input is a
    400 with `{error}`. All numeric inputs are clamped server-side.
  - `POST /api/playout/export-ocel/` — body `{variants}`; returns the
    OCEL 2.0 JSON document.
- **Frontend** (`frontend/src/playout/`) — the view (model loading from the
  editors, JSON files, or built-in examples; object counts; per-activity
  limits with an "All −/+" bulk stepper; timeout) and result rendering.
  Requests run through `frontend/src/api/playoutApi.tsx`; cancelling aborts
  the request (the server still finishes its bounded search).

## Semantics notes

- A variant's event list is shown in canonical order with canonical object
  names (`<type>_1`, `<type>_2`, … per type).
- Exact vs bound: if the search finishes within the timeout and state cap,
  the variant count is exact; otherwise it is reported as "at least N".
  Highly symmetric executions can exceed the canonicalization permutation
  cap, in which case the count is an upper bound (`approximateDedup`).
- Activity limits default to 1 occurrence per activity. Silent OCPN
  transitions get their own budget keyed `τ:<transition id>`.
- Tests live in `totem_lib/tests/playout/` (engine behavior, OCEL export
  round-trip, and raw-mode parity against `occn_playout`) and
  `backend/api/tests.py` (endpoint contract).
