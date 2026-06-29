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

## 4. Frontend Analysis View

The analysis view entry is shown in the left sidebar under Analysis as `OC Dotted Chart`. It is intended to behave like the existing Process Area, OC-DFG, and Variants analysis views: the user selects one event log centrally, opens the analysis view, and then configures only the chart.

The main frontend implementation lives in:

- `frontend/src/react_component/DottedChart.tsx`
- `frontend/src/react_component/dottedChart/DottedChartControls.tsx`
- `frontend/src/react_component/dottedChart/useDottedChartData.ts`
- `frontend/src/react_component/dottedChart/useDottedChartOptions.ts`

`useDottedChartOptions.ts` loads the available axis and encoding options from:

```text
/api/files/<file_id>/oc_dotted_chart_columns/
```

`useDottedChartData.ts` loads the chart data from:

```text
/api/files/<file_id>/oc_dotted_chart/
```

The chart uses Recharts through the shadcn chart pattern. This is a deviation from the original canvas-oriented issue text and was chosen because the onboarding material pointed toward shadcn/Recharts for charting. The current implementation therefore uses Recharts scatter rendering and custom point shapes instead of canvas draw helpers.

### Configuration

The chart starts with these defaults:

| Setting | Default |
| --- | --- |
| x-axis | `time` |
| y-axis | `activity` |
| color | `activity` |
| shape | `none` |
| row order | `first_occurrence` |

Configuration changes are staged first and are only applied when the user presses Confirm. This avoids refetching and rerendering the chart after every dropdown or slider movement.

The row order control only controls y-axis ordering. It can sort by first occurrence or last occurrence. If the user does not explicitly change the order, the chart still uses first occurrence as the default ordering so the y-axis ordering is always deterministic.

### Zoom

The analysis chart has two axis zoom controls:

- one slider for the selected y-axis dimension
- one slider for the selected x-axis dimension

When the x-axis is time-based, the chart also exposes manual date bounds in European date format:

```text
dd/mm/yyyy
```

Slider movements and manual date edits are applied through the Apply button. This lets the user adjust both bounds first and then update the chart once.

The chart also supports rectangle zoom inside the plot area. The user can click and drag inside the plot to draw a rectangle. On mouse release, the chart zooms to that rectangle and updates the axis sliders to match the selected region.

The Reset button in the zoom tile resets the axis zoom to the full available range. It is disabled when the chart is already fully expanded.

### Resampling

The Resample button is shown next to the sample count. When the chart is fully expanded, it asks the backend for a new sample across the full event log. When the chart is zoomed, it asks the backend for a new sample inside the current zoom bounds.

This means a zoom can first show a subset of the currently loaded sample, and then a resample can increase the density inside that zoomed region. If the user zooms back out after resampling a smaller region, the frontend refetches an appropriate larger frame again.

The sample count is always displayed relative to the total number of events in the log, not only relative to the currently zoomed frame.

### Tooltip And Legend

The tooltip shows the currently relevant chart values:

- activity
- activity id
- selected x-axis value
- selected y-axis value
- selected color value, when a color dimension is configured

The tooltip intentionally does not yet show every possible object type and attribute. That richer detail view is tracked separately as a later extension.

The color legend is shown below the chart. It reflects the currently selected color dimension only. For example, if the chart is colored by employees, activities do not appear in the legend.

The chart uses up to nine explicit color categories plus `Other`. `Other` is always rendered in light grey. Empty or missing values are not considered candidates for the nine explicit colors and are grouped into `Other`.

Color assignments stay stable across zooming and row-order changes. They can change when the user applies a different color dimension in the configuration.

## 5. Minimap

The minimap implementation lives in:

```text
frontend/src/react_component/dottedChart/DottedChartMinimap.tsx
```

The minimap is a compact overview of the same sampled frame used by the main chart. It does not make a separate backend request. The minimap down-samples client-side for rendering performance, but its coordinate system still represents the full loaded frame.

The minimap uses the same color scale as the main chart. This keeps colors consistent between the detailed chart, the minimap, and the legend.

### Viewport Rectangle

The black rectangle in the minimap represents the current visible x/y viewport. Dragging this rectangle moves the viewport.

While dragging, the minimap moves only the rectangle preview. The main chart is updated when the user releases the mouse. This keeps dragging responsive and avoids triggering expensive chart updates on every mouse movement.

The rectangle keeps a fixed shape while dragging. It clamps to the minimap bounds without stretching when it reaches an edge. The y-axis bounds are edge-aware so the first and last visible rows can still be selected accurately.

### Interaction Rules

Minimap mouse events take precedence over rectangle zoom in the main chart. This prevents a minimap drag from also starting a rectangle zoom in the underlying plot.

The minimap can be hidden or shown with the round map icon below it. When the minimap is visible, the icon indicates that the map can be put away. When it is hidden, the icon can restore it.

Mouse-wheel zoom, pinch zoom, and double-click reset are not part of the current implementation. They were left out because the current chart update path has a noticeable delay after zoom updates, so scroll-driven zoom would feel less predictable than the explicit sliders, rectangle zoom, and minimap drag.

## 6. Dashboard Widget

The dashboard widget integrates the OC dotted chart into the existing GridStack dashboard system.

The backend model and API integration are defined in:

- `backend/api/models.py`
- `backend/api/migrations/0011_ocdottedchartcomponent.py`
- `backend/api/serializers.py`
- `backend/api/views.py`

The frontend dashboard integration is defined in:

- `frontend/src/components/OCDottedChartComponent.tsx`
- `frontend/src/components/componentMap.tsx`
- `frontend/src/gridstack/lib/sidepanel.tsx`
- `frontend/src/context/gridstackprovider.tsx`

### Dashboard Behavior

The dashboard widget uses the centrally selected event log. It does not expose a separate event-log selector inside the widget because the event log is an application-level selection.

In dashboard edit mode, the user can configure:

- x-axis
- y-axis
- color
- shape
- row order
- max points

The dashboard stores this configuration in the saved GridStack layout. When the dashboard is reopened, the widget reloads the saved configuration and requests the corresponding OC dotted chart data again.

In dashboard view mode, the widget renders the chart itself. The full analysis configuration tile is not shown there because dashboard widgets are meant to be compact configured components. The chart still keeps the minimap toggle behavior available inside the widget.

### Testing The Widget

To test the dashboard integration:

1. Select an event log centrally in the application.
2. Open a dashboard.
3. Enable dashboard edit mode.
4. Drag the OC Dotted Chart widget from the side panel into the dashboard.
5. Configure the axes, color, shape, row order, and max points.
6. Save the dashboard layout.
7. Leave edit mode and confirm that the chart renders with the saved configuration.
8. Reload the dashboard and confirm that the saved OC dotted chart configuration is restored.

## 7. Local Validation

The OC dotted chart touches backend data preparation, Django API actions, frontend rendering, and dashboard persistence. A useful local validation pass should cover all of those layers.

### Backend Checks

Run the OC dotted chart unit tests:

```bash
node scripts/run-python.js -m pytest totem_lib/tests/test_oc_dotted_chart_db.py
```

Run the Django project check:

```bash
node scripts/run-python.js backend/manage.py check
```

For a manual endpoint check, start the backend and call:

```text
GET /api/files/<file_id>/oc_dotted_chart/?x_axis=time&y_axis=activity&color_by=activity
```

The response should include sampled `events`, `total_count`, `dataset_total_count`, `sampled`, and `outlier_count`.

Useful manual backend cases:

- default activity chart: `x_axis=time`, `y_axis=activity`, `color_by=activity`
- object instance rows: `y_axis=object_type:<object_type>`
- object attribute rows: `y_axis=object_attr:<object_type>:<attribute_name>`
- viewport sampling: include `t_min`, `t_max`, `row_min`, and `row_max`
- resampling: repeat the same request with a different `sample_seed`

### Frontend Checks

Run the frontend build:

```bash
npm run build
```

Then start the application locally and verify the analysis view:

1. Select an event log centrally.
2. Open Analysis, then OC Dotted Chart.
3. Confirm the default chart uses time on the x-axis, activity on the y-axis, and activity for color.
4. Open the configuration panel and change axes, color, shape, row order, and max points.
5. Confirm no chart update happens until Confirm is pressed.
6. Use both axis sliders and manual date input, then press Apply.
7. Draw a rectangle in the chart and confirm the chart zooms to that region.
8. Press Reset and confirm both axis zooms fully expand.
9. Press Resample while fully expanded and while zoomed.
10. Confirm the legend reflects only the selected color dimension.
11. Show, hide, and drag the minimap viewport.

### Dashboard Checks

The dashboard validation should confirm persistence:

1. Open a dashboard.
2. Enable edit mode.
3. Add the OC Dotted Chart widget.
4. Configure the widget.
5. Save the dashboard.
6. Reload the dashboard.
7. Confirm the widget and its saved configuration are restored.

## 8. Scope Decisions And Follow-Up Work

Several implementation details intentionally differ from the original issue text. This section records those decisions so they do not look accidental later.

### Naming

The feature uses `oc_dotted_chart` consistently instead of `dotted_chart`. This includes API routes, backend helper naming, and database-oriented helper naming where applicable. The explicit prefix keeps the object-centric chart separate from a regular case-based dotted chart.

### No Case Axis

The chart does not create pseudo-cases. The y-axis is a configurable row dimension. It can be activity, an object type resolved to object instances, an event attribute, an object attribute, or another supported non-time dimension.

This is different from a classical case-based dotted chart, but it fits the object-centric setting better because there is no single natural case id in an object-centric event log.

### Recharts Instead Of Canvas

The original issue text mentioned canvas draw helpers. The current implementation uses Recharts through the shadcn chart pattern instead.

This means some interactions are implemented through React and SVG event handling rather than low-level canvas drawing. The tradeoff is easier integration with the existing frontend stack, at the cost of needing careful performance handling for large samples.

### Zoom Semantics

Regular zooming shows a subset of the currently loaded sampled frame. It does not automatically resample on every zoom movement.

This is intentional. A zoom interaction should behave like zooming into what the user can already see. If zooming automatically requested a new backend sample every time, points could appear or disappear for reasons that are not visually obvious.

The explicit Resample button is the point where the user asks for a new sample. When the user is zoomed in, resampling is scoped to that zoomed region.

### Deferred Detail Tooltip

The current tooltip shows the values needed to understand the visible dot in the current chart configuration. It does not yet expose every object type, object attribute, or event attribute.

A richer expandable tooltip is tracked separately because it is more of a detail-inspection feature than a requirement for the first chart version.

### Deferred Scroll And Pinch Interactions

Mouse-wheel zoom, pinch zoom, and double-click reset are not implemented in the current version.

The reason is performance and predictability. With the current rendering path, frequent scroll-driven updates can feel laggy. The implemented controls are therefore explicit: sliders, Apply, rectangle zoom, minimap drag, Reset, and Resample.

### Remaining Follow-Up Areas

The main follow-up areas are:

- richer tooltip expansion with additional event and object context
- performance comparison between Recharts/SVG and possible canvas-based rendering
- deciding whether backend-resampled zoom should ever be offered as an optional mode
- broader visual polish for dense categorical axes and very large object-attribute charts
