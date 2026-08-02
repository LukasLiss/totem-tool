# Backend API Reference

Auto-generated reference for the `backend/api` Django app. Read this before writing or modifying backend code.

---

## 1. Data Models (`backend/api/models.py`)

### Core Models

| Model | Purpose | Key Fields | Notes |
|---|---|---|---|
| `Project` | Top-level container; users share access via M2M | `users` (M2M→User), `name` (≤30 chars), `created_at` | All queries are scoped through `project__users=request.user` for data isolation |
| `EventLog` | An uploaded OCEL file | `project` (FK→Project), `file` (FileField), `uploaded_at` | A `post_delete` signal (`signals.py`) removes the file from disk when the row is deleted. Creating an EventLog via the API auto-creates a Project named `{slugify(filename)}_{username}` |
| `ProjectAsset` | Stored model assets (TOTeM / OCCN JSON) | `project` (FK), `name` (≤100 chars), `asset_type` (TextChoices: `TOTEM`, `OCCN`), `content_json` (JSONField), `metadata` (JSONField, default `{}`), `created_by` (FK→User, SET_NULL), `created_at`, `updated_at` | `UniqueConstraint(project, name)` named `unique_project_asset_name`; index on `(project, asset_type)` |
| `Dashboard` | A named dashboard inside a project | `project` (FK), `name` (≤30), `order_in_project` (int), `created_at` | `order_in_project` is auto-assigned as `max+1` in `DashboardSerializer.create()` when omitted |

### Dashboard Component Hierarchy (multi-table inheritance)

`DashboardComponent` is the **base class** — every component on a dashboard inherits from it (Django multi-table inheritance, i.e. each subclass has an implicit `dashboardcomponent_ptr` OneToOne to the base):

```
DashboardComponent (base)
├── dashboard       FK→Dashboard (related_name="components")
├── x, y, w, h      IntegerField — GridStack-native geometry
├── component_name  CharField(100) — must match the React componentMap key
└── order           IntegerField(default=0) — z-ordering
```

Subclasses (each adds component-specific config fields):

| Subclass | Extra Fields | `component_name` string |
|---|---|---|
| `NumberofEventsComponent` | `color` (default `"blue"`) | `"NumberofEventsComponent"` / `"NumberOfEventsComponent"` (both appear in code — see §8 caveat) |
| `TextBoxComponent` | `text` (TextField), `font_size` (default 14) | `"TextBoxComponent"` |
| `ImageComponent` | `image` (ImageField, upload_to=`project_directory_path`) | `"ImageComponent"` |
| `VariantsComponent` | `automatic_loading`, `leading_object_type`, `extraction` (default `"leading_1hop"`), `iso` (default `"wl+vf2"`), `timeout_s` (default 10.0) | `"VariantsComponent"` |
| `ProcessAreaComponent` | — (no extra fields) | `"ProcessAreaComponent"` |
| `LogStatisticsComponent` | `show_num_events`, `show_num_activities`, `show_num_objects`, `show_num_object_types` (all default True), `show_earliest_timestamp`, `show_newest_timestamp`, `show_duration` (default False) | `"LogStatisticsComponent"` |
| `OCDFGComponent` | `show_controls` (True), `initial_interaction_locked` (True) | `"OCDFGComponent"` |
| `OCDottedChartComponent` | `file_id`, `x_axis` ("time"), `y_axis` ("activity"), `color_by` ("activity"), `shape_by` ("none"), `row_order` ("first_occurrence"), `max_points` (10000), `show_minimap` (True), `show_controls` (True) | `"OCDottedChartComponent"` |
| `NewOCDFGComponent` | `show_controls` (True), `initial_interaction_locked` (True), `layout_direction` (choices `TB`/`LR`, default `TB`) | `"NewOCDFGComponent"` (also matches `"NewOCDFGVariantsComponent"`) |
| `OCCNComponent` | `relative_occurrence_threshold` (FloatField 0..1, validators MinValueValidator(0.0)/MaxValueValidator(1.0)), `show_controls` (True), `initial_interaction_locked` (True), `layout_direction` (default `LR`), `object_types` (TextField, comma-separated) | `"OCCNComponent"` |

### Upload path helpers
- `user_directory_path(instance, filename)` → flat `"legacy/{filename}"` (legacy)
- `project_directory_path(instance, filename)` → `"{dashboard.project.name}/{filename}"` (used by `ImageComponent`)

---

## 2. Serializer Conventions (`backend/api/serializers.py`)

### General patterns
- Serializers are DRF `ModelSerializer` subclasses with explicit `Meta.fields` lists.
- **Security convention**: user-scoping fields are `read_only` (`project`, `uploaded_at` in `EventLogSerializer`; `created_by`, timestamps in `ProjectAssetSerializer`).
- `ProjectAssetSerializer` sets `validators = []` on Meta and implements uniqueness manually in `validate()` so the error message is friendly (`"A project asset with this name already exists in this project."`) instead of the generic `UniqueTogetherValidator` message.

### Validation hooks
- `validate_<field>(self, value)` — per-field (e.g. `validate_name` strips and rejects empty names, `validate_asset_type` checks against `ProjectAsset.AssetType.values`, `validate_project` enforces project membership using `self.context["request"].user`).
- `validate(self, attrs)` — object-level (e.g. `ProjectAssetSerializer.validate` enforces exactly one of `file` XOR `content_json`, parses the uploaded JSON file, then schema-validates via `totem_lib.validate_totem_dict` / `validate_occn_dict`, which come from `totem_lib/totem/serialization.py` and `totem_lib/occn/serialization.py`).
- **Canonical model JSON formats** (TOTeM v1 `schema: "totem"`, OCCN v1 `schema: "occn"`) are documented in `docs/MODEL_ASSETS.md`, with uploadable examples in `docs/examples/model-assets/`. The multipart upload additionally accepts `metadata` as a JSON *string* field. The uploaded file is parsed, validated, and discarded — only canonical JSON is stored in `content_json` (never a `FileField`).
- `create(self, validated_data)` — used to inject `created_by = request.user` from `self.context`.

### Dashboard component serializers
- Base `DashboardComponentSerializer` with `fields = "__all__"`.
- Each subclass serializer inherits from the base and only overrides `Meta.model`.
- **`DashboardComponentPolymorphicSerializer`** (from `django-rest-polymorphic`) maps model → serializer in `model_serializer_mapping`. **Any new component MUST be registered here** or `get_layout` will serialize it with the base serializer (losing subclass fields).

### File-upload pattern (`ProjectAssetSerializer`)
- `file = serializers.FileField(write_only=True, required=False)` — never appears in the response.
- `content_json = serializers.JSONField(required=False)` — accepts direct JSON payloads.
- Exactly one must be provided (XOR enforced in `validate`).
- Uploaded files are parsed as UTF-8 JSON; must decode to a `dict`, then validated against the `totem_lib` schema validators keyed by `asset_type`.

---

## 3. URL Routing (`backend/api/urls.py` + `backend/totem_backend/urls.py`)

### Root URL conf (`totem_backend/urls.py`)
```
/api/     → api.urls
/token/   → jwt_views.TokenObtainPairView     (POST: username/password → access+refresh)
/token/refresh/ → jwt_views.TokenRefreshView  (POST: refresh → new access)
/home/, /logout/ → authentification.urls
/files/...     → MEDIA_URL served from MEDIA_ROOT = backend/user_files/
```

### API URL conf (`api/urls.py`)
**Router-registered ViewSets** (`DefaultRouter`):
| Route | ViewSet | basename |
|---|---|---|
| `/api/files/` | `EventLogViewSet` | `userfile` |
| `/api/assets/` | `ProjectAssetViewSet` | `projectasset` |
| `/api/dashboard/` | `DashboardViewSet` | `dashboard` |

**Function-based views**:
| Route | Function | Auth |
|---|---|---|
| `GET /api/health-check/` | `health_check` | `AllowAny` |
| `GET /api/greeting/` | `greeting` | `IsAuthenticated` |
| `GET /api/ocdfg/?file_id=` | `OCDFGViewSet` | `IsAuthenticated` |
| `GET /api/new-ocdfg/?file_id=` | `NewOCDFGViewSet` | `IsAuthenticated` |
| `GET /api/occn/?file_id=` | `OCCNViewSet` | `IsAuthenticated` |
| `GET /api/variants/?file_id=` | `variants` | `IsAuthenticated` |
| `POST /api/playout/` | `playout` | `IsAuthenticated` |
| `POST /api/playout/export-ocel/` | `playout_export_ocel` | `IsAuthenticated` |
| `DELETE /api/delete-data/` | `delete_user_data` | `IsAuthenticated` |

---

## 4. ViewSet Patterns (`backend/api/views.py`)

### ViewSet anatomy (all three ViewSets follow the same shape)
```python
class FooViewSet(viewsets.ModelViewSet):
    serializer_class = FooSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Foo.objects.filter(project__users=self.request.user)   # ALWAYS scope by user

    @action(detail=True, methods=["get"])
    def my_action(self, request, pk=None):
        try:
            obj = self.get_queryset().get(pk=pk)   # NOT Foo.objects.get(pk=pk) — must stay user-scoped
        except Foo.DoesNotExist:
            return Response({"error": "..."}, status=status.HTTP_404_NOT_FOUND)
        ...
```

### Key rules
1. **Every queryset is scoped**: `.filter(project__users=self.request.user)`. Function views use `EventLog.objects.get(pk=file_id, project__users=request.user)` and catch `(EventLog.DoesNotExist, ValueError)` (ValueError covers non-numeric `?file_id`).
2. **`get_queryset().get(pk=pk)` in `@action`s**, never the global manager.
3. **`perform_create` hooks** for auto-populating relationships (`EventLogViewSet.perform_create` creates the Project; `DashboardViewSet.perform_create` re-fetches the project with user filter).
4. **Query-param filtering** in `get_queryset` (e.g. `ProjectAssetViewSet` filters on `?project=` and `?asset_type=`; `DashboardViewSet` on `?project=`).
5. **`parser_classes`** set explicitly when uploads are accepted (`[JSONParser, MultiPartParser, FormParser]`).

### Notable custom actions
- `EventLogViewSet`: `NoE`, `object_types`, `discover_totem`, `discover_mlpa`, `statistics`, `oc_dotted_chart`, `oc_dotted_chart_columns`
- `ProjectAssetViewSet`: `download` (returns `content_json` with `Content-Disposition: attachment`)
- `DashboardViewSet`: `rename` (PATCH), `get_layout`, `save_layout`, `upload_image` (multipart, custom `url_path="components/(?P<component_id>[^/.]+)/image"`)

### `get_layout` / `save_layout` contract
- `get_layout`: iterates base components, **down-casts** each to its concrete subclass via a long `if/elif` chain on `comp.component_name`, then serializes the list with `DashboardComponentPolymorphicSerializer(many=True)`. `'NewOCDFGVariantsComponent'` is an alias for `NewOCDFGComponent`.
- `save_layout`: deletes ALL existing components, then recreates them from the `layout` list in the request body, dispatching on `component_name` with `item.get('<field>', <default>)` for each subclass field. Uses `item.get('x') or 'default'` for falsy-able string fields.

---

## 5. OCEL Loading & Concurrency (critical — read before touching algorithm endpoints)

### DuckDB-first architecture
All algorithm endpoints operate on `OcelDuckDB` from `totem_lib` — **never** construct polars OCELs on the Django side.

- `_build_ocel_db_from_path(path)`: dispatches on extension — `.duckdb` → `OcelDuckDB.load`; `.sqlite/.db/.json/.xml/.csv` → `import_ocel_db` (one-time import). Raises ValueError otherwise.
- Supported: `.sqlite`, `.db`, `.json`, `.xml`, `.csv`, `.duckdb`.

### Process-local registry (NOT Django cache)
```python
_OCEL_DB_REGISTRY: dict[int, OcelDuckDB]     # per-file connection
_OCEL_DB_LOCKS:    dict[int, threading.Lock] # per-file mutex
_OCEL_DB_REGISTRY_LOCK                        # guards the dicts
```
**Why not `django.core.cache`?** `LocMemCache` pickles values, and `duckdb.DuckDBPyConnection` is an unpicklable C handle. Serializable *results* (e.g. `totem_discovery_{pk}`, `mlpa_discovery_{pk}`) DO use Django cache with `timeout=3600`.

### The `_with_ocel_db(user_file)` context manager
```python
with _with_ocel_db(user_file) as db:
    result = some_algorithm(db)
```
- **Mandatory** for any view running queries/algorithms. DuckDB connections allow only one active query; algorithms create connection-scoped TEMP TABLEs, so concurrent use on one connection corrupts state / SIGSEGVs the worker. The dashboard fires 4 endpoints in parallel — this is not theoretical.
- No TTL — connections live for the worker's lifetime.
- `_get_or_load_ocel_db` uses double-checked locking for first load.
- Helpers: `_object_types(db)` (sorted distinct types), `_optional_int(value)`, `_layout_shim(db)` (SimpleNamespace with `obj_type_map` for `calculate_layout`).

### OCCN caching
- `discover_occn` is expensive; cache threshold-0 base nets keyed `(file_id, object_types_tuple)` in `_occn_base_cache` (OrderedDict, max 4 entries, LRU via `move_to_end`), guarded by `_occn_cache_lock`. Apply `apply_relative_occurrence_threshold(t)` per request.
- Cache key deliberately has **no user component** — the ownership check always happens before the cache read.

---

## 6. API Response Structures

### Success
- ViewSets: standard DRF list/detail/pagination shapes.
- `variants` → `{"variants": [{"id", "support", "signature", "signature_hash", "graph": {"nodes", "edges", "objects"}}], "object_types": [...]}`
- `ocdfg` → `{"dfg": <networkx node_link_data with `edges="links"`>, "all_nodes": [...], optional "filter_error", "trace_variants"}`
- `new-ocdfg` → `{"dfg": {...}, "all_nodes": [...], "variant_counts": {...}}`
- `occn` → serialized OCCN dict from `totem_lib.serialize_occn`
- `statistics` → `{"num_events", "num_unique_activities", "num_objects", "num_object_types", "earliest_timestamp", "newest_timestamp"}`
- `playout` → camelCase `PlayoutResult` + `effectiveActivityLimits`: `{"variants": [{"events": [{"activity", "visible", "objects": {type: [ids]}}], "objectCounts": {type: n}}], "variantCount", "completedRuns", "statesExplored", "elapsedMs", "exhaustive", "timedOut", "stateCapHit", "approximateDedup", "warnings": [...], "effectiveActivityLimits": {key: n}}`. Hitting the timeout or state cap is a normal **200** (count is then a lower bound, communicated via the flags), only invalid input is a 400. For OCCNs, `START_<type>` / `END_<type>` pseudo-activities are auto-limited to the object count of that type (see `effectiveActivityLimits` in the response). OCPN silent transitions use budget key `τ:<transition id>`.
- `playout/export-ocel` → OCEL 2.0 JSON: `{"objectTypes", "eventTypes", "objects", "events"}` (one disconnected object component per variant)
- `variants`/`ocdfg`/`occn` discovery endpoints → long-running; see §5 caching notes
- `download` → raw `content_json` + `Content-Disposition: attachment; filename="{slug}.json"`

### Errors — every error response has an `"error"` key
| Status | When |
|---|---|
| 400 | Missing/invalid query params (`Missing ?file_id`), validation failure, bad enums, malformed body, ambiguous input |
| 404 | Object not found **or access denied** (never leak existence) |
| 408 | Variant computation `TimeoutError` (includes `code: "timeout"`, `timeout_s`, `hint`) |
| 500 | Unexpected computation failure (`f"...: {e}"`); caught broadly around `totem_lib` calls |
| 204 | Successful DELETE (DRF default) |
| 201 | Successful POST create |
| 205 | Logout (`authentification` LogoutView) |

Conventions:
```python
return Response({"error": "File not found or access denied"}, status=status.HTTP_404_NOT_FOUND)
return Response({"error": f"Invalid iso '{iso}'. Allowed: {sorted(_VALID_ISOS)}"}, status=status.HTTP_400_BAD_REQUEST)
```

### Adversarial-input hardening (playout endpoints)
- `_clamped_number(value, field, lo, hi, integer)` — rejects bool/NaN, clamps before `int()` (so `1e400` → inf gets clamped, never raises `OverflowError`).
- Bounds: `objectsPerType ≤ 12`, `activityLimits ≤ 20`, `timeoutS ∈ [1, 120]`, `maxStoredVariants ∈ [1, 2000]`, `maxStates ∈ [1, 5M]`.
- Export bounds: per-type count ≤ 10,000; total objects ≤ 500,000.
- Malformed models → `(TypeError, KeyError, AttributeError)` mapped to 400, never 500.

---

## 7. Authentication & Settings (`backend/totem_backend/settings.py`)

- JWT via `rest_framework_simplejwt`; `DEFAULT_PERMISSION_CLASSES = (IsAuthenticated,)` globally. Override per-view with `@permission_classes([AllowAny])` where needed.
- Token lifetimes: access 20 min, refresh 2 h.
- `ROTATE_REFRESH_TOKENS = True`, `BLACKLIST_AFTER_ROTATION = True`.
- SQLite DB at `backend/db.sqlite3`; media at `backend/user_files/` served under `/files/`.
- Frontend on `localhost:3000`; backend on `localhost:8000`. CORS wide open (`CORS_ORIGIN_ALLOW_ALL = True`, credentials allowed).

### `LOCAL_MODE` (Electron / local dev)
- Set env var `LOCAL_MODE=1` to enable. JWT lifetimes extend to 8 h access / 7 days refresh.
- A `Guest` user (password `guest`) is **always seeded by the data migration** `authentification/migrations/0001_seed_guest_user.py` — it runs on every `manage.py migrate` regardless of `LOCAL_MODE`; `LOCAL_MODE` mainly toggles the JWT lifetimes and the frontend's auto-login (`VITE_LOCAL_MODE=1`).
- For full-stack headless verification combining this with Playwright, see `.claude/skills/verify/SKILL.md`.

---

## 8. Testing Conventions (`backend/api/tests.py`)

- Django `TestCase` + DRF `APIClient` / `APIRequestFactory`.
- Always `self.client.force_authenticate(user=self.user)` in `setUp`; create user/project via ORM.
- Helper factories at module level: `valid_totem_content_json()`, `valid_occn_content_json()`, `tiny_ocpn_model()`, `tiny_occn_model()`, `playout_body(**overrides)`.
- File uploads with `SimpleUploadedFile(filename, json.dumps(payload).encode(), content_type=...)`.
- Mock heavy computation: `patch("api.views._with_ocel_db", return_value=nullcontext(object()))` + `patch("api.views.totemDiscovery_db", ...)`. `cache.clear()` in setUp for cached endpoints.
- Test classes: `ProjectAssetModelTests`, `ProjectAssetSerializerTests`, `EventLogTotemDiscoveryApiTests`, `ProjectAssetApiTests`, `PlayoutEndpointTests`.
- Regression tests assert adversarial inputs return 400, never 500 (e.g. `1e400` floats, empty OCCN marker groups).

---

## 9. Common Pitfalls / Gotchas

1. **`component_name` casing inconsistency**: `get_layout` matches `'NumberofEventsComponent'` but `save_layout` matches `'NumberOfEventsComponent'`. When editing either, check both.
2. **`save_layout` deletes everything** before recreating — a missing `elif` branch silently destroys that component type's data.
3. **New components need edits in 5+ places**: model, serializer + polymorphic mapping, `get_layout` down-cast branch, `save_layout` create branch, views.py import. See `.claude/skills/create-dashboard-component.md`.
4. **Never bypass `_with_ocel_db`** for DB-backed algorithms; read-only cheap scalar queries may use `_get_or_load_ocel_db` directly, but prefer the lock.
5. **Don't put unowned lookups in function views**: always `EventLog.objects.get(..., project__users=request.user)` and catch `ValueError` alongside `DoesNotExist`.
6. **Migrations are hand-numbered and merge-heavy** (`0013_merge_*`, `0016_merge_*`); after adding a field run `makemigrations` and check for new merge migrations.
7. **`DashboardViewSet.get_layout`/`save_layout`** contain `print()` debug statements — the codebase tolerates them, but prefer not adding more.
8. **`ImageField` on `ImageComponentSerializer` is read-only** — images are uploaded through the dedicated `upload_image` action instead.
9. **`file` in EventLog serializer responses is the URL path relative to MEDIA_URL** (`/files/...`). `save_layout` strips the `/files/` prefix when re-saving image paths.

---

## 10. Adding Something New — quick pointers

- **New API endpoint**: see `.claude/skills/create-api-endpoint.md`
- **New dashboard component**: see `.claude/skills/create-dashboard-component.md`
- **Verify backend after changes**: see `.claude/skills/verify-backend.md` (Django-only) or `.claude/skills/verify/SKILL.md` (full stack with Playwright)

## 11. Related in-repo documentation (`docs/`)

- `docs/MODEL_ASSETS.md` — canonical TOTeM v1 / OCCN v1 model-asset JSON formats, `/api/assets/` behavior, and the 7-step checklist for adding a new asset type.
- `docs/MODEL_EDITORS.md` — the three visual editors (TOTeM, OCCN, OCPN) and their **editor-side** JSON formats (`format: "totem-model" | "occn" | "ocpn"`) — these are what `/api/playout/` receives in `model`, distinct from the canonical asset-store format.
- `docs/PLAYOUT.md` — playout semantics (canonical ordering, exact vs. lower/upper-bound counts, silent-transition budgets), backend request/response contract, and where the engine lives in `totem_lib/playout/`.
- `docs/OCCN_PRECISION.md` — math behind the OCCN context-based precision metric.
- `docs/OC_DOTTED_CHART.md` — dotted-chart sampling contract.
- `docs/examples/model-assets/` — uploadable `totem-v1.json` / `occn-v1.json` fixtures.

### Asset store vs. editor formats (do not confuse)
| | Canonical asset store (`/api/assets/`) | Editor format (`/api/playout/`) |
|---|---|---|
| Discriminant | `schema` ∈ `{"totem", "occn"}`, `version: 1` | `format` ∈ `{"totem-model", "occn", "ocpn"}`, `version: 1` |
| Purpose | persisted project assets for conformance | transient, in-request model for playout |
| Shape | `tempgraph` … / `dependency_graph` … | `relations` … / `markerGroups`, places/transitions |
| Validators | `validate_totem_dict`, `validate_occn_dict` | editor-side + `playout_from_model_dict` |
