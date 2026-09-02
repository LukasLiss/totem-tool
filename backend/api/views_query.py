"""
Backend for the SQL Editor dashboard widget.

Two endpoints: `query_columns` feeds the table/column browser, `query_execute`
runs a user-authored SELECT against the OCEL data for one uploaded file.
Both resolve `file_id` to an `EventLog` the same way the other per-file
algorithm endpoints do (see `NewOCDFGViewSet`/`OCCNViewSet` in `views.py`),
and reuse `_with_ocel_db` so a query never races an algorithm run on the same
DuckDB connection.
"""

import re
from typing import Any

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import EventLog
from .views import _with_ocel_db

# Every table the SQL editor may reference — see
# totem_lib/src/totem_lib/ocel/ocel_duckdb.py:create_ocel_schema. All
# attribute columns are VARCHAR regardless of source type; cast explicitly
# for numeric operations (e.g. cost::DOUBLE).
EXPOSED_TABLES = (
    "events",
    "objects",
    "event_object",
    "object_attribute_history",
    "object_relations",
)

# Structural PK/FK hints — not fabricated, these follow directly from the
# schema DDL.
COLUMN_NOTES = {
    ("events", "event_id"): "PK",
    ("objects", "obj_id"): "PK",
    ("event_object", "event_id"): "FK -> events",
    ("event_object", "obj_id"): "FK -> objects",
    ("object_attribute_history", "obj_id"): "FK -> objects",
    ("object_relations", "source_obj_id"): "FK -> objects",
    ("object_relations", "target_obj_id"): "FK -> objects",
}

# Reject anything that isn't a read-only statement before it ever reaches
# DuckDB. This is the primary guard: connections for non-.duckdb uploads are
# writable (see `_build_ocel_db_from_path` in views.py), so nothing else
# stops a malicious/careless query from mutating data.
SELECT_ONLY = re.compile(r"^\s*(--[^\n]*\n\s*)*(select|with)\b", re.IGNORECASE)


def _resolve_user_file(request):
    file_id = request.query_params.get("file_id") or request.data.get("file_id")
    if not file_id:
        return None, Response({"error": "Missing file_id"}, status=400)
    try:
        user_file = EventLog.objects.get(id=file_id, project__users=request.user)
    except (EventLog.DoesNotExist, ValueError):
        return None, Response(
            {"error": "File not found or access denied"}, status=404
        )
    return user_file, None


def _describe_table(conn, table: str) -> dict[str, Any]:
    described = conn.execute(f'DESCRIBE "{table}"').fetchall()
    columns = [
        {
            "name": row[0],
            "type": str(row[1]),
            "note": COLUMN_NOTES.get((table, row[0])),
        }
        for row in described
    ]
    row_count = conn.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
    return {"name": table, "columns": columns, "rowCount": int(row_count)}


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def query_columns(request):
    """Schema of every table the SQL editor may reference, for one file."""
    user_file, error = _resolve_user_file(request)
    if error:
        return error
    try:
        with _with_ocel_db(user_file) as db:
            tables = [_describe_table(db.conn, t) for t in EXPOSED_TABLES]
        return Response({"tables": tables})
    except Exception as e:
        return Response({"error": f"Schema lookup failed: {e}"}, status=500)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def query_execute(request):
    """Run a user-authored SELECT/WITH query against one file's OCEL data."""
    query = request.data.get("query", "")
    if not SELECT_ONLY.match(query):
        return Response(
            {"error": "Only SELECT queries are allowed."}, status=400
        )
    user_file, error = _resolve_user_file(request)
    if error:
        return error
    try:
        with _with_ocel_db(user_file) as db:
            cursor = db.conn.execute(query)
            columns = [d[0] for d in cursor.description]
            # Safety cap independent of the widget's display row_limit — this
            # is about not pulling an unbounded result set over the wire.
            rows = cursor.fetchmany(10_000)
        data = [dict(zip(columns, row)) for row in rows]
        return Response({"data": data, "columns": columns})
    except Exception as e:
        return Response({"error": str(e)}, status=400)
