# OCEL Editor

The **OCEL Editor** (Editor section in the left side panel, below the model
editors) edits object-centric event logs themselves: the events with their
event-to-object relations (E2O), the objects with their attributes, and the
object-to-object relations (O2O).

## Working copies

The editor never touches an existing project directly. It always works on an
**ephemeral working copy** stored as a native DuckDB file under
`user_files/_ocel_editor/`:

- **New event log** — start from an empty log.
- **Upload an OCEL file** — import `.sqlite`, `.json`, `.xml`, `.csv` or
  `.duckdb` (OCEL 2.0) and edit a copy.
- **Edit current project log** — copy the event log of the currently opened
  project; the original stays untouched.

A working copy only becomes permanent when the user clicks **Save as
project**, which stores the current state as a new Project/EventLog (DuckDB
format) in the user's account. Unsaved working copies are deleted: explicitly
via **Discard**, or automatically once a session has been untouched for three
days.

## Editing

Three tabs, all paginated, filterable and sortable **server-side** — the
frontend only ever holds one page of the log:

| Tab | Contents |
| --- | --- |
| Events (E2O) | One row per event (id, activity, timestamp, attributes) with one column per object type listing the related objects. Add/edit/delete events, including their related objects with qualifiers. |
| Objects | Object id, type, attribute summary and event usage. Expanding a row opens an inline attribute editor (attributes are edited rarely, so they don't get a separate dialog). Renaming an object cascades through all E2O/O2O references. |
| Relations (O2O) | Source/target/qualifier rows with an inline add/update form. Saving an existing (source, target) pair updates its qualifier. |

## Exports

- **Download** — DuckDB (native), or OCEL 2.0 SQLite / JSON / XML via pm4py.
  Event and object attribute columns are preserved in all formats.
- **LaTeX** — the E2O table (id / activity / timestamp / one column per
  object type, using `multirow` headers) and the O2O table as
  copy-paste-ready `tabular` environments. Row output is capped at 500 rows;
  the dialog says when the export was truncated.

## Architecture

All logic lives in `totem_lib.ocel.editor.OcelEditor` (SQL against the
working DuckDB file: pagination, filtering, CRUD with validation and cascade,
dynamic attribute columns, LaTeX rendering, format export). The Django layer
(`backend/api/views_ocel_editor.py`) is a thin HTTP wrapper that resolves the
session, holds a per-session lock (DuckDB allows only one writer per file)
and calls exactly one editor method per request. Endpoints live under
`/api/ocel-editor/`.

Object attribute edits are mirrored into the `object_attribute_history`
table so they survive re-import and every export format.
