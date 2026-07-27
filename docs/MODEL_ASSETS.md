# Model Assets

Model assets are project-scoped JSON models that can be reused by later analysis
and conformance workflows. The first supported asset types are `TOTEM` and
`OCCN`.

This document is grounded in the current implementation:

- Backend data model: `backend/api/models.py`
- Backend validation and serialization: `backend/api/serializers.py`
- Backend API behavior: `backend/api/views.py`
- Frontend API client: `frontend/src/api/assetsApi.tsx`
- TOTeM JSON serializer: `totem_lib/src/totem_lib/totem/serialization.py`
- OCCN JSON serializer: `totem_lib/src/totem_lib/occn/serialization.py`

## Current Scope

The asset store keeps the parsed JSON content, not the uploaded source file. A
model asset belongs to one project, has a user-facing name, has an asset type,
and stores validated JSON content.

The currently supported asset types are:

- `TOTEM`
- `OCCN`

## Project Scoping

This ticket does not change the existing event-log-centered project lifecycle.
Uploading an event log creates its project, and the selected event log determines
the active project throughout the frontend. The Model Assets view therefore
loads and manages assets for the project associated with the currently selected
event log.

Event logs remain stored files because analysis algorithms read their OCEL
content. Model assets differ deliberately: their upload file is parsed and
discarded, and only validated canonical JSON is stored.

## Asset Concept

A project asset is reusable project data that is not an event log. For this
epic, project assets are model assets used by conformance workflows.

Every asset has:

- `project`: the project that owns the asset.
- `name`: a user-facing name that must be unique inside the project.
- `asset_type`: the model kind. Currently `TOTEM` or `OCCN`.
- `content_json`: the validated JSON model content.
- `metadata`: optional structured metadata for later extensions.
- `created_by`: the user that created the asset.
- `created_at` and `updated_at`: audit timestamps.

The original uploaded file is not stored. Uploading a file is only one way to
provide JSON content to the API. The backend parses the file, validates the JSON,
and stores the resulting object in `content_json`.

Asset names are unique per project across all asset types. This means a project
cannot have both a `TOTEM` asset and an `OCCN` asset with the same `name`.

## API Behavior

The asset API is exposed through the Django REST router at:

```text
/api/assets/
```

The API requires authentication. Querysets are scoped to projects accessible by
the current user.

Supported operations:

- `GET /api/assets/`: list accessible assets.
- `GET /api/assets/?project=<project_id>`: list assets for one project.
- `GET /api/assets/?asset_type=TOTEM`: list accessible TOTeM assets.
- `GET /api/assets/?asset_type=OCCN`: list accessible OCCN assets.
- `GET /api/assets/?project=<project_id>&asset_type=TOTEM`: list assets by
  project and type.
- `POST /api/assets/`: create an asset from either multipart file upload or
  direct JSON content.
- `GET /api/assets/<asset_id>/`: retrieve one asset.
- `DELETE /api/assets/<asset_id>/`: delete one asset.
- `GET /api/assets/<asset_id>/download/`: return the stored JSON content as a
  downloadable JSON response.

Multipart upload accepts:

- `project`: project id.
- `name`: unique asset name inside the project.
- `asset_type`: `TOTEM` or `OCCN`.
- `file`: UTF-8 JSON file.
- `metadata`: optional JSON string.

The HTTP API and current upload form require `asset_type` explicitly. Backend
validation verifies that the selected type and canonical model structure agree.

Direct JSON creation accepts:

```json
{
  "project": 1,
  "name": "Example TOTeM model",
  "asset_type": "TOTEM",
  "content_json": {
    "schema": "totem",
    "version": 1,
    "tempgraph": {
      "nodes": ["Order"],
      "D": [],
      "Di": [],
      "I": [],
      "Ii": [],
      "P": []
    },
    "cardinalities": [],
    "type_relations": [],
    "all_event_types": ["Create Order"],
    "object_type_to_event_types": {
      "Order": ["Create Order"]
    }
  },
  "metadata": {}
}
```

Exactly one of `file` and `content_json` must be provided. Sending both is
rejected, and sending neither is rejected.

The download endpoint returns the stored `content_json`. The download filename
is derived from the asset name and always uses a `.json` extension.

### TOTeM conformance endpoint

TOTeM conformance checking combines one event log with an existing TOTeM asset:

```text
POST /api/files/<file_id>/totem_conformance/
```

The request body selects the model asset:

```json
{
  "asset_id": 42
}
```

The event log and asset must both be accessible to the authenticated user and
must belong to the same project. The selected asset must have type `TOTEM` and
contain valid canonical TOTeM JSON. The endpoint reconstructs that stored model
and checks it against the event log; it does not discover a new model from the
checked log.

A successful response contains:

- `file_id` and `asset_id`: the inputs used for the calculation.
- `overall_metrics`: fitness and precision for temporal, log-cardinality, and
  event-cardinality conformance.
- `object_type_metrics`: averaged metrics for each object type.
- `type_pair_metrics`: model relations and metrics for each directed type pair.
- `histograms`: aggregate and detailed counts used by the visualization.

Invalid request data, wrong asset types, cross-project assets, and invalid
stored TOTeM JSON are rejected before computation. Inaccessible resources
return `404`; invalid accessible inputs return `400`; failures while loading the
event log or calculating conformance return `500`.

## TOTeM Conformance Workflow

The desktop workflow is available under **Conformance > TOTeM Conformance**.
It combines the selected event log with one stored TOTeM asset from that event
log's project.

The workflow has two entry points:

- Open **TOTeM Conformance** from the sidebar, then select a stored model.
- Use the conformance action on a TOTeM row in **Project Assets > Model
  Assets**. This opens the same workflow with that asset preselected.

The selected event log remains the source of the active project context. The
frontend requests only `TOTEM` assets from that project. Assets belonging to
other projects and OCCN assets are not selectable.

Execution proceeds as follows:

1. The user selects a stored TOTeM model.
2. **Run conformance** calls the event-log endpoint with the selected asset id.
3. The previous result is cleared while the request is running.
4. A successful response is checked against the current event-log and asset
   ids before it is displayed.
5. The stored model is rendered with the returned conformance metrics.

Changing the selected model, event log, or project clears the current result.
Responses from requests whose inputs changed while they were running are
ignored. The user can then run conformance again with the new inputs. Execution
is disabled while required context is missing, assets are loading, or another
calculation is running.

The result view provides:

- Overall fitness and precision for temporal, log-cardinality, and
  event-cardinality conformance.
- A metric selector that controls which fitness dimension colors the model.
- Object-type details when a model node is selected.
- Directional relation metrics and available histogram details when a model
  relation is selected.
- Explicit states for unavailable, invalid, empty, stale, loading, and failed
  results.

This workflow always checks an existing stored model. TOTeM discovery is a
separate workflow and is not performed implicitly before conformance checking.

## Validation Behavior

General asset validation:

- `name` is trimmed and must not be empty.
- `asset_type` must be one of the supported backend enum values.
- `project` must be accessible by the authenticated user.
- `name` must be unique within the selected project.
- JSON content must be an object.

File upload validation:

- The uploaded file must be UTF-8 encoded.
- The uploaded file must contain valid JSON.
- The parsed JSON value must be an object.

Type-specific validation:

- `TOTEM` assets are validated by `validate_totem_dict`.
- `OCCN` assets are validated by `validate_occn_dict`.

Both model validators require:

- `schema`: identifies the model format.
- `version`: identifies the schema version.

Current supported schemas:

- `TOTEM`: `schema` must be `"totem"` and `version` must be `1`.
- `OCCN`: `schema` must be `"occn"` and `version` must be `1`.

Common validation failures include:

- Unsupported asset type.
- Duplicate asset name in the project.
- Invalid JSON syntax.
- JSON root value is not an object.
- Missing or unsupported model schema.
- Unsupported model schema version.
- References to unknown object types, activities, event types, or dependency
  edges inside the model content.

## TOTeM JSON Format (Version 1)

A TOTeM asset uses `schema: "totem"` and `version: 1`. The complete top-level
shape is:

```json
{
  "schema": "totem",
  "version": 1,
  "tempgraph": {},
  "cardinalities": [],
  "type_relations": [],
  "all_event_types": [],
  "object_type_to_event_types": {}
}
```

### `tempgraph`

`tempgraph` contains the object types and the temporal relations between them:

- `nodes`: list of object type names.
- `D`: dependent relation edges.
- `Di`: inverse dependent relation edges.
- `I`: initiating relation edges.
- `Ii`: reverse initiating relation edges.
- `P`: parallel relation edges.

Every relation field is required, even when it is an empty list. An edge is a
two-item string array in `[source, target]` order. Both endpoints must occur in
`tempgraph.nodes`.

```json
{
  "nodes": ["Item", "Order"],
  "D": [["Order", "Item"]],
  "Di": [],
  "I": [],
  "Ii": [],
  "P": [["Item", "Order"]]
}
```

### `cardinalities`

`cardinalities` is a list of cardinality records. Each record contains:

- `from`: source object type from `tempgraph.nodes`.
- `to`: target object type from `tempgraph.nodes`.
- `log_cardinality`: cardinality across the complete event log.
- `event_cardinality`: cardinality at event level.

The supported cardinality strings are `"total"`, `"0"`, `"1"`, `"0...1"`,
`"1..*"`, and `"0...*"`. The current serializer also accepts `"None"` and
`"ERROR 0"` because existing discovery code can produce these states. They are
compatibility values rather than recommended values for manually authored
models.

### Type and event mappings

- `type_relations`: list of two-item object type pairs. Both values must occur
  in `tempgraph.nodes`. A type relation is treated as an unordered pair by the
  in-memory model.
- `all_event_types`: list of every event type used by the model.
- `object_type_to_event_types`: object whose keys are object types from
  `tempgraph.nodes`. Every mapped value is a list of names from
  `all_event_types`.

The serializer produces deterministically sorted lists and edges. Input does not
need to be pre-sorted, but using serializer order makes model files easier to
compare and review.

## OCCN JSON Format (Version 1)

An OCCN asset uses `schema: "occn"` and `version: 1`. Its complete top-level
shape is:

```json
{
  "schema": "occn",
  "version": 1,
  "activities": [],
  "object_types": [],
  "dependency_graph": { "edges": [] },
  "input_marker_groups": {},
  "output_marker_groups": {},
  "activity_count": {},
  "relative_occurrence_threshold": 0
}
```

### Activities and object types

- `activities`: unique list of all activity names in the net.
- `object_types`: unique list of all object type names in the net.

For every object type `<type>`, the activities list must contain the artificial
activities `START_<type>` and `END_<type>`. For example, object type `order`
requires `START_order` and `END_order`.

### Dependency graph

`dependency_graph.edges` is a list of directed, object-type-specific edges. Each
edge contains:

- `source`: activity where the edge starts.
- `target`: activity where the edge ends.
- `object_type`: object type carried by the edge.

Sources and targets must occur in `activities`, and the object type must occur
in `object_types`. The same `(source, target, object_type)` combination may not
occur more than once.

### Marker groups

`input_marker_groups` and `output_marker_groups` are objects keyed by activity.
They must contain exactly one key for every entry in `activities`, including
activities without marker groups. An activity without marker groups maps to an
empty list.

Each marker group contains:

- `support_count`: non-negative integer, or `null` for unbounded/infinite
  support.
- `markers`: non-empty list of marker objects.

Each marker contains:

- `related_activity`: another activity participating in the binding.
- `object_type`: object type of the marker.
- `min_count`: non-negative minimum cardinality.
- `max_count`: non-negative maximum cardinality, or `null` for an unbounded
  maximum. A finite maximum must be at least `min_count`.
- `marker_key`: positive integer retained by the OCCN binding semantics.

Marker direction must agree with the dependency graph. For an input marker
group belonging to activity `A`, a marker with related activity `B` requires an
edge `B -> A` for the same object type. For an output marker group belonging to
`A`, the corresponding edge must be `A -> B`.

The JSON value `null` is the canonical representation for Python infinity in
`support_count` and `max_count`. Deserialization converts it back to infinity.

### Counts and threshold

- `activity_count`: object with exactly one key for every activity. Values are
  non-negative integers.
- `relative_occurrence_threshold`: number between `0` and `1`, inclusive. It
  controls filtering of infrequent marker groups when constructing the OCCN.

## Optional `layout` block (editor interop)

Both the TOTeM and OCCN formats accept an **optional** top-level `layout`
object. It carries purely presentational information written by the visual
model editors (see [MODEL_EDITORS.md](MODEL_EDITORS.md)): node positions,
colors, and — for OCCN — dependency arcs that carry no marker groups but should
survive a round trip.

`layout` is validated only when present, and it is ignored when the JSON is
turned back into a `Totem` / `OCCausalNet` in `totem_lib`. This keeps an
editor-saved file a strict superset of the miner format: it uploads to the
asset store with no conversion, and a downloaded asset re-opens in the editor
with its layout intact. A model without `layout` (e.g. straight from the miner)
remains valid.

Every entity referenced in `layout` must exist in the model itself, so a layout
can never introduce phantom object types, activities, or arcs.

TOTeM `layout`:

```json
{
  "layout": {
    "objectTypes": {
      "Order": { "position": { "x": 40, "y": 300 }, "color": "#8B5CF6" },
      "Item": { "position": { "x": 640, "y": 470 } }
    }
  }
}
```

OCCN `layout`:

```json
{
  "layout": {
    "activities": { "send": { "position": { "x": 470, "y": 205 } } },
    "objectTypes": { "order": { "color": "#2563EB" } },
    "arcs": [
      { "source": "START_order", "target": "send", "object_type": "order" }
    ]
  }
}
```

Both `position` (`{ "x": number, "y": number }`) and `color` are optional inside
a layout entry.

## Example Model Files

The repository contains complete canonical examples:

- [TOTeM v1 example](examples/model-assets/totem-v1.json)
- [OCCN v1 example](examples/model-assets/occn-v1.json)

These files contain the model payload itself, not the surrounding asset API
request. They can be uploaded directly in the Model Assets view by selecting
the matching model type. They can also be used as `content_json` for direct JSON
creation.

## Adding a New Asset Type

Adding an asset type requires one canonical model format and coordinated changes
across the library, backend, frontend, tests, and this documentation.

1. Define a versioned JSON shape and its conversion functions in `totem_lib`.
   Provide `to_dict`, `from_dict`, and validation functions without depending
   on Django or the frontend.
2. Export the conversion and validation functions through the relevant
   `totem_lib` package modules.
3. Add the new value to `ProjectAsset.AssetType` in `backend/api/models.py` and
   create the resulting Django migration.
4. Register the model validator in `ProjectAssetSerializer._validate_content_json`
   in `backend/api/serializers.py`.
5. Extend the frontend `AssetType` union in `frontend/src/api/assetsApi.tsx`,
   register its expected schema, and add it to the upload form and Model Assets
   filters.
6. Add library roundtrip and malformed-input tests, backend upload/API tests,
   and a canonical example JSON file.
7. Document the new schema, version, validation behavior, and example here.

The uploaded source file must remain an import transport only. New asset types
should continue storing their validated canonical object in `content_json`
instead of introducing type-specific file storage.
