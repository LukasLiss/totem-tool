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

## Project Workspace Behavior

A project is an independent workspace rather than an alias for one event log.
It can exist without an event log and can contain multiple event logs and model
assets. A project may have a user-defined name. An unnamed explicitly created
project uses the stable display fallback `Project <id>`. Uploading an event log
without first selecting a project creates one named
`<event-log-filename-stem>_project`.

Event logs remain stored files because analysis algorithms read their OCEL
content. Model assets differ deliberately: their upload file is parsed and
discarded, and only validated canonical JSON is stored.

The initial Project Workspace screen exposes four operations:

- Select or create a project.
- Upload an event log, creating a project from its filename when necessary.
- Upload a TOTeM or OCCN model into the selected project.
- Select the active event log used by analysis and conformance views.

When a selected project contains exactly one event log, that log becomes active
automatically. Projects with no logs or multiple logs require no selection or an
explicit selection, respectively. Event logs can be deleted from the Event Logs
view. Deleting the active log clears the workspace selection, removes the
database row and stored file, and leaves the project itself intact.

The Event Logs view reports the file type derived from the filename and a `Last
changed` timestamp. Existing logs initialize that timestamp from their original
upload time.

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
- `POST /api/assets/validate/`: validate a multipart model file without storing
  an asset. The initial project-creation flow uses this before creating the
  project, avoiding partial projects for invalid models.
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

The HTTP API keeps `asset_type` explicit as a storage and query contract. The
frontend does not ask the user to select it: it infers `TOTEM` from
`schema: "totem"` and `OCCN` from `schema: "occn"`, then sends the inferred type
to the API. Backend validation verifies that the supplied type and canonical
model structure agree.

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

## Example Model Files

The repository contains complete canonical examples:

- [TOTeM v1 example](examples/model-assets/totem-v1.json)
- [OCCN v1 example](examples/model-assets/occn-v1.json)

These files contain the model payload itself, not the surrounding asset API
request. They can be uploaded directly in the initial Project Workspace or
Model Assets view; the model type is inferred from `schema`. They can also be
used as `content_json` for direct JSON creation.

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
   register its schema-to-type inference, and add it to Model Assets filters.
6. Add library roundtrip and malformed-input tests, backend upload/API tests,
   and a canonical example JSON file.
7. Document the new schema, version, validation behavior, and example here.

The uploaded source file must remain an import transport only. New asset types
should continue storing their validated canonical object in `content_json`
instead of introducing type-specific file storage.
