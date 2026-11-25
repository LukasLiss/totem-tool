"""
Validation and execution of model-written SQL against an event log.

The assistant may run ad-hoc SQL over the OCEL DuckDB tables. The connection
is already opened read-only, so writes to the database are impossible, but
DuckDB can still read arbitrary server files (``read_csv('/etc/passwd')``,
``SELECT * FROM 'x.parquet'``), read environment variables (``getenv``) or
write files (``COPY ... TO``). The guard parses the statement with DuckDB's
own parser (``json_serialize_sql``) and accepts only a single SELECT whose
table references are the event-log tables or its own CTEs, with no table
functions and no file/environment functions.
"""

from __future__ import annotations

import json
import threading
from typing import Any, Dict, Iterable, List, Set

# Tables of the OCEL DuckDB schema the assistant may read.
OCEL_TABLES: Set[str] = {
    "events",
    "event_object",
    "objects",
    "object_attribute_history",
    "object_relations",
}

_DENIED_FUNCTIONS: Set[str] = {
    "getenv",
    "glob",
    "query",
    "query_table",
    "current_setting",
    "json_execute_serialized_sql",
}
_DENIED_FUNCTION_PREFIXES = ("read_", "sniff_", "parquet_", "duckdb_", "iceberg_", "delta_")
_DENIED_FUNCTION_SUBSTRINGS = ("_scan",)

MAX_SQL_LENGTH = 8000


class SqlRejected(ValueError):
    """The SQL is not an allowed read-only query over the event log."""


def _walk(node: Any) -> Iterable[Dict[str, Any]]:
    stack = [node]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            yield cur
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)


def validate_select(conn, sql: str) -> str:
    """Return the normalized SQL if it is an allowed SELECT, else raise SqlRejected."""
    if not isinstance(sql, str) or not sql.strip():
        raise SqlRejected("SQL must be a non-empty string.")
    if len(sql) > MAX_SQL_LENGTH:
        raise SqlRejected(f"SQL is longer than {MAX_SQL_LENGTH} characters.")
    cleaned = sql.strip().rstrip(";").strip()

    row = conn.execute("SELECT json_serialize_sql(?)", [cleaned]).fetchone()
    tree = json.loads(row[0]) if row else {"error": True}
    if tree.get("error"):
        message = tree.get("error_message") or "could not parse the statement"
        raise SqlRejected(f"Only a single SELECT statement is allowed ({message}).")

    statements = tree.get("statements") or []
    if len(statements) != 1:
        raise SqlRejected("Send exactly one SELECT statement.")

    cte_names: Set[str] = set()
    for node in _walk(statements):
        cte_map = node.get("cte_map")
        if isinstance(cte_map, dict):
            for entry in cte_map.get("map") or []:
                if isinstance(entry, dict) and isinstance(entry.get("key"), str):
                    cte_names.add(entry["key"].lower())

    for node in _walk(statements):
        node_type = node.get("type")
        if node_type == "TABLE_FUNCTION":
            raise SqlRejected("Table functions (read_csv, range, ...) are not allowed; query the event-log tables.")
        if node_type == "BASE_TABLE":
            table = str(node.get("table_name", "")).lower()
            schema = str(node.get("schema_name", "")).lower()
            catalog = str(node.get("catalog_name", "")).lower()
            if catalog or schema not in ("", "main"):
                raise SqlRejected(f"Only tables of the active event log can be queried (got {catalog or schema}.{table}).")
            if table not in OCEL_TABLES and table not in cte_names:
                raise SqlRejected(
                    f"Unknown table '{table}'. Available tables: {', '.join(sorted(OCEL_TABLES))}."
                )
        if node.get("class") == "FUNCTION":
            name = str(node.get("function_name", "")).lower()
            if (
                name in _DENIED_FUNCTIONS
                or name.startswith(_DENIED_FUNCTION_PREFIXES)
                or any(s in name for s in _DENIED_FUNCTION_SUBSTRINGS)
            ):
                raise SqlRejected(f"Function '{name}' is not allowed.")
    return cleaned


def run_select(conn, sql: str, max_rows: int = 200, timeout_s: float = 20.0) -> Dict[str, Any]:
    """Validate and execute ``sql``; return columns, rows and a truncation flag."""
    cleaned = validate_select(conn, sql)

    timer = threading.Timer(timeout_s, conn.interrupt)
    timer.start()
    try:
        cursor = conn.execute(cleaned)
        columns = [d[0] for d in (cursor.description or [])]
        rows = cursor.fetchmany(max_rows + 1)
    except Exception as exc:  # duckdb errors carry useful messages for the model
        if "interrupt" in str(exc).lower():
            raise SqlRejected(f"Query exceeded the {timeout_s:.0f}s time limit; aggregate more or add filters.") from exc
        raise SqlRejected(f"Query failed: {exc}") from exc
    finally:
        timer.cancel()

    truncated = len(rows) > max_rows
    rows = rows[:max_rows]
    return {
        "columns": columns,
        "rows": [[_jsonable(v) for v in r] for r in rows],
        "row_count": len(rows),
        "truncated": truncated,
    }


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    return str(value)


def describe_schema(conn) -> List[Dict[str, Any]]:
    """Columns and row counts of the event-log tables present in this database."""
    out = []
    tables = conn.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name"
    ).fetchall()
    for (table,) in tables:
        if table not in OCEL_TABLES:
            continue
        cols = conn.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'main' AND table_name = ? ORDER BY ordinal_position",
            [table],
        ).fetchall()
        count = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        out.append({"table": table, "rows": count, "columns": [f"{c} {t}" for c, t in cols]})
    return out
