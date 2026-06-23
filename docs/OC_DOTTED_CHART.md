# Object-Centric Dotted Chart

## Overview

The Object-Centric Dotted Chart is an event-level visualization for object-centric event logs. It shows sampled events as dots and lets the user decide which event or object-centric dimension is used for the x-axis, y-axis, color, and shape.

The feature is intentionally named `oc_dotted_chart` in code and API routes. This keeps it clearly separate from a regular case-based dotted chart. The chart does not assume a single case id. Instead, the y-axis is a configurable row dimension such as activity, object instance, qualifier, event attribute, or object attribute.

The default view is designed to work for every imported event log:

- x-axis: `time`
- y-axis: `activity`
- color: `activity`
- shape: `none`
- y-axis order: `first_occurrence`

This default is intentionally conservative because every event log is expected to have timestamp and activity information, while object-centric dimensions vary by log.

The implementation has three main parts:

- DuckDB-backed backend data preparation and sampling in `totem_lib/src/totem_lib/oc_dotted_chart/oc_dotted_chart_db.py`
- Django API actions in `backend/api/views.py`
- React visualization and controls in `frontend/src/react_component/DottedChart.tsx` and `frontend/src/react_component/dottedChart/`

## Backend Endpoint

The main data endpoint is:

```text
GET /api/files/<file_id>/oc_dotted_chart/
```

The column/options endpoint is:

```text
GET /api/files/<file_id>/oc_dotted_chart_columns/
```

Both endpoints load the selected event log through the DuckDB-backed OCEL path. The dotted chart data endpoint delegates to `get_oc_dotted_chart_data(...)`, while the columns endpoint delegates to `get_oc_dotted_chart_columns(...)`.

### Query Parameters

`oc_dotted_chart` accepts these query parameters:

| Parameter | Default | Purpose |
| --- | --- | --- |
| `x_axis` | `time` | Dimension used on the x-axis. |
| `y_axis` | `activity` | Dimension used to form chart rows. If omitted, activity is used. |
| `color_by` | `activity` | Dimension used for dot color. |
| `shape_by` | `none` | Dimension used for dot shape. |
| `row_order` | `first_occurrence` | Ordering of y-axis rows. Supported values are `first_occurrence` and `last_occurrence`. |
| `max_points` | backend default `3000`; frontend commonly sends `10000` or higher | Point budget before hard clamping. |
| `sample_seed` | `0` | Seed offset used to request a different sample. |
| `t_min` | none | Lower timestamp bound for viewport/refetch sampling. |
| `t_max` | none | Upper timestamp bound for viewport/refetch sampling. |
| `row_min` | none | Lower row-index bound for viewport/refetch sampling. |
| `row_max` | none | Upper row-index bound for viewport/refetch sampling. |

`max_points` is clamped by the backend. The current hard maximum is `20000`. This protects the frontend from excessive rendering and protects the API from returning very large sampled payloads.

### Response Shape

The response contains:

| Field | Meaning |
| --- | --- |
| `events` | Sampled event rows used by the chart. |
| `total_count` | Number of events matching the current filters and selected dimensions before sampling. |
| `dataset_total_count` | Number of events matching the selected dimensions across the full dataset. |
| `sampled` | Whether the returned `events` array is a sample of a larger result set. |
| `outlier_count` | Number of preserved outliers in the returned sample. |

Each event contains normalized chart values and context:

| Field | Meaning |
| --- | --- |
| `id` | Event id. |
| `x` | Raw x-axis value. |
| `y` | Raw y-axis value. |
| `color_value` | Raw color dimension value. |
| `shape_value` | Raw shape dimension value. |
| `activity` | Event activity. |
| `timestamp` | Original timestamp value when available. |
| `timestamp_unix` | Numeric timestamp used for time-based calculations. |
| `row_id` | Stable row identity. |
| `row_index` | Numeric row index assigned by the backend. |
| `event_index_in_row` | Event order inside the row. |
| `objects` | Object ids grouped by object type for tooltip/context use. |

### Sampling

The endpoint samples after applying the selected dimensions and optional viewport filters. The sampling logic combines:

- a point budget derived from `max_points`
- time buckets over `timestamp_unix`
- ranking within buckets
- explicit outlier preservation

The intent is to keep the chart responsive while preserving a useful spread across the time range and retaining unusual events. The backend currently caps the point budget at `20000`.

The frontend can request a new sample by changing `sample_seed`. In the chart, this is used by the resample behavior. If the user is zoomed into a viewport, resampling is scoped to that viewport.

## Axis And Encoding Model

The OC Dotted Chart does not use a case notion. The y-axis represents whatever row dimension the user selected. This is important because object-centric event logs generally do not have one natural case id.

### Built-In Dimensions

The backend recognizes these built-in dimension values:

| Value | Meaning |
| --- | --- |
| `time` | Timestamp rendered as time. Internally this maps to `timestamp_unix`. |
| `timestamp` | Timestamp value. Internally this also maps to `timestamp_unix` for chart positioning. |
| `timestamp_unix` | Numeric timestamp value. |
| `since_start` | Time elapsed since the first event in the log. |
| `activity` | Event activity. |
| `object_id` | Object id from the event-object relation. |
| `object_type` | Object type from the event-object relation. |
| `qualifier` | Event-object qualifier. |
| `none` | No value. Used for optional encodings such as shape or color. |

### Event Attributes

Event attributes are exposed by their column name. For example, if the DuckDB `events` table has an event attribute column called `resource`, the dimension value is:

```text
resource
```

Event attributes can appear in the options returned by `oc_dotted_chart_columns`. The backend marks a column as time-related if `_is_time_related_column(...)` classifies it as time-like; otherwise it is treated as categorical.

### Object Types

For the y-axis, selecting an object type means the rows become object instances of that type. The persisted/query value format is:

```text
object_type:<object_type>
```

For example:

```text
object_type:orders
```

This means the y-axis shows order instances such as `o-990679`, not the literal label `orders`.

### Object Attributes

Object attributes are exposed with the object type attached to the attribute. The value format is:

```text
object_attr:<object_type>:<attribute_name>
```

For example:

```text
object_attr:orders:price
```

This makes it explicit that `price` belongs to `orders`. The frontend may display this as `orders.price`, but the API value uses the colon-separated format above.

### Axis Rules

The current UI follows these rules:

- x-axis options are time-like dimensions.
- y-axis options are non-time row dimensions, including activity, event attributes, object instances, qualifier, and object attributes.
- color options are categorical dimensions plus `none`.
- shape options are categorical dimensions plus `none`.

The default y-axis is activity even though activity is also the default color. This is intentional because it produces a useful chart for every event log without requiring object-specific configuration.

### Row Ordering

Rows can be ordered by:

- `first_occurrence`: rows are sorted by the earliest event timestamp in that row.
- `last_occurrence`: rows are sorted by the latest event timestamp in that row.

This ordering is applied to the selected y-axis rows. It is not case sorting.
