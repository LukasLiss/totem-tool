# Skill: Create API Endpoint

Step-by-step workflow for adding a new endpoint to the Django backend (route + view logic + serializer + model field + tests). Follow the conventions in `.claude/reference.md` — read it first.

---

## Choose the Right Pattern

Decide upfront which of the two existing endpoint styles fits:

| Pattern | Use when | Example |
|---|---|---|
| **Add `@action` to an existing ViewSet** | The endpoint operates on an existing model (EventLog, ProjectAsset, Dashboard) and needs CRUD context | `EventLogViewSet.statistics` |
| **New function view with `@api_view`** | Standalone computation endpoint, usually parameterized by `?file_id=` | `variants`, `OCCNViewSet` |
| **New ViewSet** | A brand-new model with full CRUD | `ProjectAssetViewSet` |

---

## Step 1: Model Field (only if persisting new data)

**File**: `backend/api/models.py`

1. Add the field or model. Follow existing conventions:
   - Components inherit from `DashboardComponent` (multi-table inheritance).
   - New top-level resources get `project = models.ForeignKey(Project, on_delete=models.CASCADE)`.
   - Use sensible defaults so existing rows migrate cleanly: `null=True, blank=True` for optional, or a `default=`.
   - Use `models.TextChoices` for enums (see `ProjectAsset.AssetType`).
   - Use validators where applicable: `validators=[MinValueValidator(0.0), MaxValueValidator(1.0)]`.

```python
class MyComponent(DashboardComponent):
    my_threshold = models.FloatField(default=0.5, null=True, blank=True)
```

2. Create + apply the migration:

```bash
cd backend
python manage.py makemigrations
python manage.py migrate
```

3. Check the generated migration — this project has several merge migrations (`0013_merge_*`, `0016_merge_*`). If `makemigrations` produces conflicts, resolve with `python manage.py makemigrations --merge`.

---

## Step 2: Serializer

**File**: `backend/api/serializers.py`

1. New model → new `ModelSerializer`. Explicit `Meta.fields`, mark ownership/timestamps read-only:

```python
class MyModelSerializer(serializers.ModelSerializer):
    created_by = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = MyModel
        fields = ["id", "project", "name", "created_by", "created_at"]
        read_only_fields = ["id", "created_by", "created_at"]
```

2. Add validation hooks when accepting user input:
   - `validate_<field>` for per-field rules.
   - `validate(attrs)` for cross-field rules (see the `file` XOR `content_json` pattern in `ProjectAssetSerializer`).
   - Enforce project membership in `validate_project` using `self.context["request"].user` — mirror the `ProjectAssetSerializer` implementation.
   - Inject `created_by` in `create()` from `self.context["request"]`.

3. **New dashboard component** → subclass `DashboardComponentSerializer` AND register it in `DashboardComponentPolymorphicSerializer.model_serializer_mapping` (bottom of serializers.py). Forgetting the mapping silently drops subclass fields from `get_layout` responses.

> **Adding a new model-asset type** (ProjectAsset.AssetType) is a different, broader workflow — it touches `totem_lib` serialization, backend validation, tests, frontend filters, and `docs/MODEL_ASSETS.md`. Follow the 7-step checklist in `docs/MODEL_ASSETS.md` ("Adding a New Asset Type") instead of this skill.

---

## Step 3: View

**File**: `backend/api/views.py`

### 3a. ViewSet action (for model-bound endpoints)

```python
class EventLogViewSet(viewsets.ModelViewSet):
    # ...
    @action(detail=True, methods=["get"])
    def my_analysis(self, request, pk=None):
        try:
            user_file = self.get_queryset().get(pk=pk)   # NEVER EventLog.objects.get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            with _with_ocel_db(user_file) as db:          # MANDATORY — see 3c
                result = my_totem_lib_function(db)
        except Exception as e:
            return Response({"error": f"Failed to compute: {e}"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(result, status=status.HTTP_200_OK)
```

### 3b. Function view (for standalone computation endpoints)

```python
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_analysis(request):
    # 1. Required params first
    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response({"error": "Missing ?file_id parameter"},
                        status=status.HTTP_400_BAD_REQUEST)

    # 2. Optional params with validated defaults
    raw_threshold = request.query_params.get("threshold", "0.5")
    try:
        threshold = float(raw_threshold)
        if not (0.0 <= threshold <= 1.0):
            raise ValueError
    except (TypeError, ValueError):
        return Response({"error": "threshold must be a float in [0, 1]"},
                        status=status.HTTP_400_BAD_REQUEST)

    # 3. Ownership-scoped lookup — catch ValueError for non-numeric ids
    try:
        user_file = EventLog.objects.get(pk=file_id, project__users=request.user)
    except (EventLog.DoesNotExist, ValueError):
        return Response({"error": "File not found or access denied"},
                        status=status.HTTP_404_NOT_FOUND)

    # 4. Compute under the per-file lock
    try:
        with _with_ocel_db(user_file) as db:
            result = my_totem_lib_function(db)
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    return Response(result, status=status.HTTP_200_OK)
```

### 3c. Rules that are NOT optional

- **Access control**: every queryset/lookup scopes through `project__users=request.user`. 404 for "not found OR not yours" — never distinguish.
- **DuckDB concurrency**: anything touching an `OcelDuckDB` goes inside `with _with_ocel_db(user_file) as db:`. Algorithms create connection-scoped TEMP TABLES — concurrent use can crash the worker. The registry and locks already exist in views.py; just use them.
- **Caching results** (expensive computations): only cache *serializable* results with Django's cache:
  ```python
  cache_key = f"my_analysis_{user_file.pk}"
  cached = cache.get(cache_key)
  if cached:
      return Response(cached, status=status.HTTP_200_OK)
  ...
  cache.set(cache_key, serialized, timeout=3600)
  ```
  Never cache `OcelDuckDB` objects (unpicklable C handles — that's why `_OCEL_DB_REGISTRY` exists).
- **Error responses** always use `{"error": <message>}` with the right status code (see §6 of reference.md). Catch expected library exceptions → 400/408; broad `except Exception` → 500.
- **Adversarial inputs**: validate/clamp all numerics that reach computation (reuse `_clamped_number` / `_clamped_count_map` patterns from the playout endpoint). Malformed input must be a 400, never a 500.
- **Long-running / bounded search semantics**: if your endpoint can legitimately hit a budget (timeout, state cap, max variants), return a **200** with flags in the payload (like playout's `timedOut` / `stateCapHit` / `approximateDedup`) — reserve 400/500 for *invalid input* and *unexpected failure*. A consumed budget is normal, not an error. (The `variants` endpoint's 408 TimeoutError is the older exception to this; new endpoints should follow the playout pattern.)

### 3d. New ViewSet (new model with CRUD)

```python
class MyModelViewSet(viewsets.ModelViewSet):
    serializer_class = MyModelSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = MyModel.objects.filter(project__users=self.request.user)
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
```

Add `parser_classes = [JSONParser, MultiPartParser, FormParser]` if accepting file uploads.

---

## Step 4: URL Route

**File**: `backend/api/urls.py`

- ViewSet → register with the router:
  ```python
  router.register(r'my-models', MyModelViewSet, basename="mymodel")
  ```
- Function view → add a path:
  ```python
  path("my-analysis/", my_analysis, name="my_analysis"),
  ```
- Don't forget the import line at the top of urls.py.
- Route style in this project: kebab-case for standalone endpoints (`health-check/`, `new-ocdfg/`, `playout/export-ocel/`), snake_case for action names (`discover_totem`, `get_layout`).

---

## Step 5: Tests

**File**: `backend/api/tests.py`

Add a `TestCase` class following existing conventions:

```python
class MyAnalysisApiTests(TestCase):
    def setUp(self):
        cache.clear()  # if endpoint caches
        self.client = APIClient()
        self.user = User.objects.create_user(username="my-test-user")
        self.project = Project.objects.create(name="Project A")
        self.project.users.add(self.user)
        self.event_log = EventLog.objects.create(project=self.project, file="test-log.json")
        self.client.force_authenticate(user=self.user)
```

Cover at minimum:

1. **Happy path** — mock heavy computation:
   ```python
   with (
       patch("api.views._with_ocel_db", return_value=nullcontext(object())),
       patch("api.views.my_totem_lib_function", return_value={"result": 1}),
   ):
       response = self.client.get(f"/api/files/{self.event_log.pk}/my_analysis/")
   self.assertEqual(response.status_code, status.HTTP_200_OK)
   ```
2. **Auth required** — unauthenticated `APIClient()` gets 401/403.
3. **User isolation** — another user's object returns 404.
4. **Bad input** — missing/invalid params return 400 with `"error"` in the body.
5. **Adversarial input** — malformed payloads return 400, never 500 (see `PlayoutEndpointTests` for patterns like raw JSON with `1e400`).

Run the tests:

```bash
cd backend
python manage.py test api
```

---

## Checklist

- [ ] Chose pattern: ViewSet action / function view / new ViewSet
- [ ] Model field added (if needed) + `makemigrations` + `migrate` (watch for merge migrations)
- [ ] Serializer created; ownership fields read-only; validation hooks added
- [ ] Component registered in `DashboardComponentPolymorphicSerializer` (dashboard components only)
- [ ] View created; queryset scoped by `project__users=request.user`
- [ ] `_with_ocel_db` used for ALL `OcelDuckDB` access
- [ ] Expensive results cached via `django.core.cache` (serialized data only)
- [ ] Errors follow `{"error": msg}` convention with correct status codes
- [ ] Numeric inputs validated/clamped (no 500s from adversarial JSON)
- [ ] Route added in `urls.py` (+ import)
- [ ] Tests: happy path, auth, isolation, bad input; `python manage.py test api` passes
- [ ] Frontend API wrapper added in `frontend/src/api/` (separate step, outside this skill)
