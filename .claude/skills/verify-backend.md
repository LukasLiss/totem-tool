# Skill: Verify Backend

Run this after any change to `backend/api/` (models, serializers, views, urls) to confirm the Django backend still works end-to-end: migration state, system checks, test suite, and a live smoke test of key endpoints including JSON log-schema validation.

Prerequisite knowledge: `.claude/reference.md` (architecture) and `.claude/PROJECT_CONTEXT.md` (dev environment).

---

## Step 1: Sanity-check config & imports

From the **repo root** (commands are Windows `cmd.exe` style; backend runs from `backend/`):

```bash
cd backend
python manage.py check
```

Expected: `System check identified no issues (0 silenced).`
If it fails → fix import errors / missing fields before continuing.

---

## Step 2: Migrations

```bash
cd backend
python manage.py makemigrations --check --dry-run
python manage.py migrate --check
```

- `makemigrations --check --dry-run`: exits non-zero if model changes exist without a migration. If it fails → run `python manage.py makemigrations`, inspect the generated file, then `python manage.py migrate`.
- `migrate --check`: exits non-zero if there are unapplied migrations. If it fails → run `python manage.py migrate`.
- **Merge-migration warning**: this project already has merge migrations (`0013_merge_oc_dotted_chart_new_ocdfg`, `0016_merge_projectasset_occncomponent`). If `makemigrations` reports conflicting leaf nodes, resolve with `python manage.py makemigrations --merge`.

---

## Step 3: Run the test suite

```bash
cd backend
python manage.py test api
```

Expected: all tests pass. Suites currently covering: `ProjectAssetModelTests`, `ProjectAssetSerializerTests`, `EventLogTotemDiscoveryApiTests`, `ProjectAssetApiTests`, `PlayoutEndpointTests`.

- A failure in `PlayoutEndpointTests` with status 500 instead of 400 usually means adversarial input validation (clamping/NaN guards) was broken — see `_clamped_number` in views.py.
- A 404→200 change on foreign objects usually means a queryset lost its `project__users=request.user` scope.
- For a single class: `python manage.py test api.tests.PlayoutEndpointTests`

---

## Step 4: Smoke-test the running server

Start the server (leave it running in a separate terminal):

```bash
cd backend
python manage.py runserver
```

### 4a. Unauthenticated checks

```bash
curl -s http://localhost:8000/api/health-check/
```

Expected: `{"status":"ok","message":"Backend is running."}` — verifies server + routing without auth.

```bash
curl -s http://localhost:8000/api/files/
```

Expected: `401` with `{"detail":"Authentication credentials were not provided."}` — confirms JWT protection is active.

### 4b. Authenticate

```bash
curl -s -X POST http://localhost:8000/token/ -H "Content-Type: application/json" -d "{\"username\": \"Guest\", \"password\": \"guest\"}"
```

The `Guest`/`guest` user is seeded by the data migration `backend/authentification/migrations/0001_seed_guest_user.py` on **every** `manage.py migrate` — it works with or without `LOCAL_MODE=1` (`LOCAL_MODE` only relaxes JWT lifetimes and drives frontend auto-login). If the password ever drifted on an existing DB, re-running `python manage.py migrate` resets it to `guest`.

Copy the `access` token into the next calls:

```bash
curl -s http://localhost:8000/api/greeting/ -H "Authorization: Bearer <ACCESS>"
```

Expected: `{"message":"Hello, greetings from the backend!"}` — confirms the JWT round-trip works.

### 4c. Core API surface

```bash
curl -s http://localhost:8000/api/files/ -H "Authorization: Bearer <ACCESS>"
curl -s http://localhost:8000/api/assets/ -H "Authorization: Bearer <ACCESS>"
curl -s http://localhost:8000/api/dashboard/ -H "Authorization: Bearer <ACCESS>"
```

Expected: JSON lists (possibly empty). Errors here → check `get_queryset` scoping and serializers.

---

## Step 5: Validate JSON log/asset schemas

### 5a. TOTeM / OCCN asset schemas

Asset creation validates `content_json` against `totem_lib.validate_totem_dict` / `validate_occn_dict`. Verify the validators still work and accept canonical payloads:

```bash
cd backend
python manage.py shell -c "from api.tests import valid_totem_content_json, valid_occn_content_json; from totem_lib import validate_totem_dict, validate_occn_dict; validate_totem_dict(valid_totem_content_json()); validate_occn_dict(valid_occn_content_json()); print('TOTEM + OCCN schemas OK')"
```

Expected: `TOTEM + OCCN schemas OK`. A `ValueError` here means the schema validators in totem_lib changed and `ProjectAssetSerializer` / test fixtures may need updating.

### 5b. Uploaded event-log structure (DuckDB schema)

The real schema check for uploaded logs is a live discovery request — it exercises the full load path (`_build_ocel_db_from_path` → `OcelDuckDB`). If the user has an uploaded log (get its id from `GET /api/files/`):

```bash
curl -s "http://localhost:8000/api/files/<FILE_ID>/object_types/" -H "Authorization: Bearer <ACCESS>"
curl -s "http://localhost:8000/api/files/<FILE_ID>/statistics/" -H "Authorization: Bearer <ACCESS>"
```

Expected for `statistics`:
```json
{"num_events": N, "num_unique_activities": N, "num_objects": N, "num_object_types": N, "earliest_timestamp": ..., "newest_timestamp": ...}
```

These fail if the log's `events`/`objects` tables lack the columns the queries expect (`activity`, `obj_type`, `timestamp_unix`) — i.e. the DuckDB schema contract.

### 5c. Heavy algorithms (optional — needs a real uploaded log)

```bash
curl -s "http://localhost:8000/api/ocdfg/?file_id=<FILE_ID>" -H "Authorization: Bearer <ACCESS>"
curl -s "http://localhost:8000/api/new-ocdfg/?file_id=<FILE_ID>" -H "Authorization: Bearer <ACCESS>"
curl -s "http://localhost:8000/api/occn/?file_id=<FILE_ID>" -H "Authorization: Bearer <ACCESS>"
```

- `ocdfg`/`new-ocdfg` → response has `dfg` with `nodes` + `links` (note: `links`, not `edges` — the frontend depends on it) and `all_nodes`.
- `occn` → serialized OCCN dict.
- To exercise the concurrency lock specifically, fire these in parallel (the dashboard does exactly this) and confirm no worker crash.
- For the playout endpoints, a timeout/state-cap run is still a **200** — check `timedOut` / `stateCapHit` flags instead of status codes; `variantCount` is then a lower bound. `approximateDedup=true` means it may be an upper bound. See `docs/PLAYOUT.md`.

---

## Step 6: Watch for the usual regressions

While checking output, look for these project-specific failure modes:

1. Responses leaking data across users → queryset lost `project__users=request.user`.
2. `{"error": ...}` shape changed → frontend error handling breaks.
3. Component fields missing from `GET /api/dashboard/<id>/get_layout/` → component not registered in `DashboardComponentPolymorphicSerializer`.
4. Component data lost after save → `save_layout` deleted all components and the new one's `elif` branch is missing.
5. Server crashes under parallel requests to DFG/OCCN endpoints → code bypassed `_with_ocel_db`.
6. 500s on weird JSON bodies → input clamping removed (playout endpoints).

---

## Quick Reference (all in one)

```bash
cd backend
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py migrate --check
python manage.py test api
:: then, with a server running on :8000:
curl -s http://localhost:8000/api/health-check/
```

---

## Checklist

- [ ] `manage.py check` — no system errors
- [ ] No missing migrations (`makemigrations --check --dry-run`)
- [ ] No unapplied migrations (`migrate --check`)
- [ ] `python manage.py test api` — all green
- [ ] `health-check` reachable without auth; `files/` rejects anonymous
- [ ] JWT obtain + authenticated `greeting` works
- [ ] TOTEM/OCCN schema validators accept canonical payloads
- [ ] `statistics` returns all six counters for a real log
- [ ] DFG/OCCN endpoints return expected JSON shapes (`nodes`/`links`)

> Full-stack verification (Vite frontend + Playwright driving flows like Playout, uploads, and dashboards) is a separate runbook: `.claude/skills/verify/SKILL.md`.
