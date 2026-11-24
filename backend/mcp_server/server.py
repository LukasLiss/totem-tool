"""
Assistant tool catalog and executor.

Every tool the assistant can call is declared once in ``TOOLS`` with:

* a JSON schema (validated before execution),
* a ``kind`` that decides how the harness treats a call:
    - ``READ``    runs immediately and its result goes back to the model;
    - ``PROPOSE`` changes user data, so it is held for explicit approval;
    - ``CLIENT``  is executed by the browser (navigation, guided tours);
* the modes it is offered in (``teach`` / ``act``),
* a handler returning a JSON-serializable dict sized for a model's context
  (summaries, not raw algorithm output).

Handlers raise ``ToolError`` for expected failures; the message is written for
the model so it can recover (pick another log, fix an argument, ...).
"""

from __future__ import annotations

import datetime as _dt
import enum
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, FrozenSet, List, Optional

import jsonschema

from api.models import EventLog, ProjectAsset
from api.services.dashboard import DashboardService

from .sql_guard import SqlRejected, describe_schema, run_select


class ToolKind(str, enum.Enum):
    READ = "read"
    PROPOSE = "propose"
    CLIENT = "client"


class ToolError(Exception):
    """An expected tool failure, reported to the model as an error result."""

    def __init__(self, message: str, code: str = "TOOL_ERROR", hint: Optional[str] = None):
        super().__init__(message)
        self.code = code
        self.hint = hint

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"error": str(self), "code": self.code}
        if self.hint:
            out["hint"] = self.hint
        return out


@dataclass
class ToolContext:
    """What a tool may rely on besides its arguments."""

    user: Any
    active_file_id: Optional[int] = None
    project_id: Optional[int] = None
    dashboard_id: Optional[int] = None


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: Dict[str, Any]
    kind: ToolKind
    handler: Optional[Callable[[ToolContext, Dict[str, Any]], Dict[str, Any]]] = None
    modes: FrozenSet[str] = field(default_factory=lambda: frozenset({"teach", "act"}))
    describe: Optional[Callable[[Dict[str, Any]], str]] = None

    def spec(self) -> Dict[str, Any]:
        return {"name": self.name, "description": self.description, "parameters": self.parameters}

    def summary(self, args: Dict[str, Any]) -> str:
        if self.describe:
            try:
                return self.describe(args)
            except Exception:
                pass
        return self.name.replace("_", " ")


# -----------------------------------------------------------------------------
# Shared helpers
# -----------------------------------------------------------------------------

_FILE_ID = {"type": "integer", "description": "Event log id (from list_event_logs). Defaults to the log selected in the UI."}


def _obj(properties: Dict[str, Any], required: Optional[List[str]] = None) -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


def _iso(ts: Any) -> Optional[str]:
    if ts is None:
        return None
    try:
        value = float(ts)
    except (TypeError, ValueError):
        return None
    if value > 1e11:  # milliseconds
        value /= 1000.0
    return _dt.datetime.fromtimestamp(value, tz=_dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _duration(seconds: Any) -> Optional[str]:
    if seconds is None:
        return None
    s = float(seconds)
    if s < 120:
        return f"{s:.0f}s"
    if s < 7200:
        return f"{s / 60:.1f}min"
    if s < 172800:
        return f"{s / 3600:.1f}h"
    return f"{s / 86400:.1f}d"


def _log_label(log: EventLog) -> Dict[str, Any]:
    return {
        "file_id": log.id,
        "file_name": os.path.basename(log.file.name) if log.file else None,
        "project": log.project.name if log.project_id else None,
    }


def _require_user(ctx: ToolContext):
    user = ctx.user
    if not user or not getattr(user, "is_authenticated", False):
        raise ToolError("Not signed in.", code="UNAUTHENTICATED")
    return user


def _resolve_log(ctx: ToolContext, args: Dict[str, Any]) -> EventLog:
    user = _require_user(ctx)
    file_id = args.get("file_id", ctx.active_file_id)
    if file_id is None:
        raise ToolError(
            "No event log is selected in the UI and no file_id was given.",
            code="NO_EVENT_LOG",
            hint="Call list_event_logs and pass the file_id of the log the user means.",
        )
    try:
        file_id = int(file_id)
    except (TypeError, ValueError):
        raise ToolError(f"file_id must be an integer, got {file_id!r}.", code="INVALID_ARGUMENT")

    log = EventLog.objects.select_related("project").filter(id=file_id, project__users=user).first()
    if log is None:
        raise ToolError(
            f"Event log {file_id} does not exist or is not accessible.",
            code="FILE_NOT_FOUND",
            hint="Call list_event_logs to see the logs this user can access.",
        )
    try:
        path = log.file.path if log.file else None
    except Exception:
        path = None
    if not path or not os.path.exists(path):
        raise ToolError(f"The file of event log {file_id} is missing on disk.", code="FILE_MISSING")
    return log


def _ocel(log: EventLog):
    # Imported lazily: api.views pulls in the whole view layer.
    from api.views import _with_ocel_db

    return _with_ocel_db(log)


def _object_type_names(conn) -> List[str]:
    return [r[0] for r in conn.execute("SELECT DISTINCT obj_type FROM objects ORDER BY 1").fetchall()]


def _check_object_type(conn, object_type: Optional[str]) -> Optional[str]:
    if object_type is None:
        return None
    types = _object_type_names(conn)
    if object_type not in types:
        raise ToolError(
            f"Unknown object type '{object_type}'.",
            code="INVALID_ARGUMENT",
            hint=f"Object types in this log: {', '.join(types)}.",
        )
    return object_type


# -----------------------------------------------------------------------------
# Read tools
# -----------------------------------------------------------------------------

def list_event_logs(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    user = _require_user(ctx)
    logs = EventLog.objects.select_related("project").filter(project__users=user).order_by("-uploaded_at", "-id")[:100]
    return {
        "event_logs": [
            {
                **_log_label(log),
                "uploaded_at": log.uploaded_at.isoformat() if getattr(log, "uploaded_at", None) else None,
                "selected_in_ui": log.id == ctx.active_file_id,
            }
            for log in logs
        ]
    }


def get_log_overview(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    log = _resolve_log(ctx, args)
    with _ocel(log) as db:
        c = db.conn
        n_events, n_acts, t_min, t_max = c.execute(
            "SELECT COUNT(*), COUNT(DISTINCT activity), MIN(timestamp_unix), MAX(timestamp_unix) FROM events"
        ).fetchone()
        n_objects = c.execute("SELECT COUNT(*) FROM objects").fetchone()[0]
        n_e2o = c.execute("SELECT COUNT(*) FROM event_object").fetchone()[0]
        per_type = c.execute(
            """
            WITH life AS (
                SELECT o.obj_type, o.obj_id, COUNT(*) AS n_events,
                       MAX(e.timestamp_unix) - MIN(e.timestamp_unix) AS span
                FROM objects o
                JOIN event_object eo ON eo.obj_id = o.obj_id
                JOIN events e ON e.event_id = eo.event_id
                GROUP BY 1, 2
            )
            SELECT t.obj_type, t.n,
                   AVG(l.n_events), MEDIAN(l.span), MAX(l.span)
            FROM (SELECT obj_type, COUNT(*) AS n FROM objects GROUP BY 1) t
            LEFT JOIN life l ON l.obj_type = t.obj_type
            GROUP BY t.obj_type, t.n
            ORDER BY t.n DESC
            """
        ).fetchall()
        top_acts = c.execute(
            "SELECT activity, COUNT(*) FROM events GROUP BY 1 ORDER BY 2 DESC LIMIT 15"
        ).fetchall()
        schema = describe_schema(c)

    return {
        **_log_label(log),
        "events": n_events,
        "activities": n_acts,
        "objects": n_objects,
        "event_object_links": n_e2o,
        "time_range": {"start": _iso(t_min), "end": _iso(t_max), "span": _duration((t_max or 0) - (t_min or 0))},
        "object_types": [
            {
                "object_type": t,
                "objects": n,
                "avg_events_per_object": round(avg or 0, 2),
                "median_lifecycle": _duration(med),
                "max_lifecycle": _duration(mx),
            }
            for t, n, avg, med, mx in per_type
        ],
        "most_frequent_activities": [{"activity": a, "events": k} for a, k in top_acts],
        "schema": schema,
        "timestamp_unit": "timestamp_unix is seconds since the Unix epoch (UTC)",
    }


def get_activity_stats(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    log = _resolve_log(ctx, args)
    limit = int(args.get("limit", 50))
    with _ocel(log) as db:
        c = db.conn
        otype = _check_object_type(c, args.get("object_type"))
        where = "WHERE e.event_id IN (SELECT eo.event_id FROM event_object eo JOIN objects o ON o.obj_id = eo.obj_id WHERE o.obj_type = ?)" if otype else ""
        params = [otype] if otype else []
        rows = c.execute(
            f"""
            WITH per_event AS (
                SELECT e.event_id, e.activity, e.timestamp_unix, COUNT(eo.obj_id) AS n_obj
                FROM events e LEFT JOIN event_object eo ON eo.event_id = e.event_id
                {where}
                GROUP BY 1, 2, 3
            )
            SELECT activity, COUNT(*), MIN(timestamp_unix), MAX(timestamp_unix), AVG(n_obj)
            FROM per_event GROUP BY 1 ORDER BY 2 DESC LIMIT ?
            """,
            params + [limit],
        ).fetchall()
        types_per_activity = dict(
            (a, ts)
            for a, ts in c.execute(
                """
                SELECT e.activity, LIST(DISTINCT o.obj_type ORDER BY o.obj_type)
                FROM events e JOIN event_object eo ON eo.event_id = e.event_id
                JOIN objects o ON o.obj_id = eo.obj_id GROUP BY 1
                """
            ).fetchall()
        )
    total = sum(r[1] for r in rows) or 1
    return {
        **_log_label(log),
        "object_type_filter": otype,
        "activities": [
            {
                "activity": a,
                "events": n,
                "share_pct": round(100.0 * n / total, 1),
                "first": _iso(t0),
                "last": _iso(t1),
                "avg_objects_per_event": round(avg or 0, 2),
                "object_types": types_per_activity.get(a, []),
            }
            for a, n, t0, t1, avg in rows
        ],
    }


def get_directly_follows(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    log = _resolve_log(ctx, args)
    limit = int(args.get("limit", 40))
    with _ocel(log) as db:
        c = db.conn
        otype = _check_object_type(c, args.get("object_type"))
        if otype is None:
            raise ToolError(
                "object_type is required: directly-follows relations are computed per object type.",
                code="INVALID_ARGUMENT",
                hint=f"Object types in this log: {', '.join(_object_type_names(c))}.",
            )
        base = """
            WITH oe AS (
                SELECT eo.obj_id, e.event_id, e.activity, e.timestamp_unix AS ts
                FROM event_object eo
                JOIN events e ON e.event_id = eo.event_id
                JOIN objects o ON o.obj_id = eo.obj_id
                WHERE o.obj_type = ?
            ), seq AS (
                SELECT obj_id, activity, ts,
                       LEAD(activity) OVER w AS nxt, LEAD(ts) OVER w AS nxt_ts,
                       ROW_NUMBER() OVER w AS pos,
                       COUNT(*) OVER (PARTITION BY obj_id) AS len
                FROM oe WINDOW w AS (PARTITION BY obj_id ORDER BY ts, event_id)
            )
        """
        edges = c.execute(
            base
            + """
            SELECT activity, nxt, COUNT(*), MEDIAN(nxt_ts - ts), AVG(nxt_ts - ts), MAX(nxt_ts - ts)
            FROM seq WHERE nxt IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC LIMIT ?
            """,
            [otype, limit],
        ).fetchall()
        starts = c.execute(
            base + "SELECT activity, COUNT(*) FROM seq WHERE pos = 1 GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
            [otype],
        ).fetchall()
        ends = c.execute(
            base + "SELECT activity, COUNT(*) FROM seq WHERE pos = len GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
            [otype],
        ).fetchall()
    return {
        **_log_label(log),
        "object_type": otype,
        "edges": [
            {
                "from": a,
                "to": b,
                "frequency": n,
                "median_wait": _duration(med),
                "mean_wait": _duration(mean),
                "max_wait": _duration(mx),
                "median_wait_seconds": med,
            }
            for a, b, n, med, mean, mx in edges
        ],
        "start_activities": [{"activity": a, "objects": n} for a, n in starts],
        "end_activities": [{"activity": a, "objects": n} for a, n in ends],
    }


def query_event_log(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    log = _resolve_log(ctx, args)
    max_rows = min(int(args.get("max_rows", 100)), 200)
    with _ocel(log) as db:
        try:
            result = run_select(db.conn, args["sql"], max_rows=max_rows)
        except SqlRejected as exc:
            raise ToolError(
                str(exc),
                code="SQL_REJECTED",
                hint="Use a single SELECT over events, event_object, objects, object_attribute_history, object_relations.",
            )
    return {**_log_label(log), **result}


def find_variants_tool(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    from totem_lib.variants import find_variants

    log = _resolve_log(ctx, args)
    extraction = args.get("extraction", "leading_1hop")
    top_k = int(args.get("top_k", 10))
    timeout_s = float(args.get("timeout_s", 20))
    with _ocel(log) as db:
        types = _object_type_names(db.conn)
        leading = args.get("leading_object_type")
        if extraction.startswith("leading"):
            if leading is None:
                raise ToolError(
                    "leading_object_type is required for leading-type extraction.",
                    code="INVALID_ARGUMENT",
                    hint=f"Object types in this log: {', '.join(types)}. Pick the case notion the user cares about.",
                )
            _check_object_type(db.conn, leading)
        else:
            leading = None
        try:
            mined = find_variants(
                db, extraction=extraction, leading_type=leading, iso="wl+vf2", timeout_s=timeout_s, verbose=False
            )
        except TimeoutError:
            raise ToolError(
                f"Variant mining did not finish within {timeout_s:.0f}s.",
                code="TIMEOUT",
                hint="Retry with extraction='leading_1hop' or a different leading_object_type.",
            )

    variants = sorted(mined, key=lambda v: v.support, reverse=True)
    total = sum(v.support for v in variants) or 1
    out = []
    for rank, var in enumerate(variants[:top_k], 1):
        nodes = sorted(var.graph.nodes(data=True), key=lambda x: x[1].get("timestamp", 0))
        activities = [d.get("label", "") for _, d in nodes]
        types_in = sorted({t for _, d in nodes for t in (d.get("types") or [])})
        out.append(
            {
                "rank": rank,
                "cases": var.support,
                "share_pct": round(100.0 * var.support / total, 1),
                "events": len(activities),
                "activity_sequence": activities[:40] + (["..."] if len(activities) > 40 else []),
                "object_types": types_in,
            }
        )
    return {
        **_log_label(log),
        "extraction": extraction,
        "leading_object_type": leading,
        "total_cases": total,
        "distinct_variants": len(variants),
        "top_variants": out,
        "coverage_of_top_pct": round(100.0 * sum(v["cases"] for v in out) / total, 1),
    }


def discover_totem(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    from totem_lib.totem import totem_to_dict, totemDiscovery_db

    log = _resolve_log(ctx, args)
    tau = float(args.get("tau", 0.9))
    with _ocel(log) as db:
        try:
            model = totem_to_dict(totemDiscovery_db(db, tau=tau))
        except Exception as exc:
            raise ToolError(f"TOTeM discovery failed: {exc}", code="EXECUTION_ERROR")
    tg = model.get("tempgraph", {})

    def pairs(key):
        return [list(p) for p in tg.get(key, [])]

    return {
        **_log_label(log),
        "tau": tau,
        "object_types": tg.get("nodes", []),
        "temporal_relations": {
            "dependent (D, drawn as 'during')": pairs("D"),
            "dependent_inverse (Di)": pairs("Di"),
            "initiating (I, drawn as 'precedes')": pairs("I"),
            "initiating_inverse (Ii)": pairs("Ii"),
            "parallel (P)": pairs("P"),
        },
        "cardinalities": model.get("cardinalities", []),
        "activities_per_object_type": model.get("object_type_to_event_types", {}),
    }


def discover_occn(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    from totem_lib import discover_occn as _discover, serialize_occn

    log = _resolve_log(ctx, args)
    threshold = float(args.get("threshold", 0.0))
    object_types = args.get("object_types") or None
    with _ocel(log) as db:
        for t in object_types or []:
            _check_object_type(db.conn, t)
        try:
            base = _discover(db, relativeOccuranceThreshold=0.0, parameters={"object_types": object_types} if object_types else {})
            occn = base.apply_relative_occurrence_threshold(threshold) if threshold > 0 else base
            data = serialize_occn(occn)
        except Exception as exc:
            raise ToolError(f"OCCN discovery failed: {exc}", code="EXECUTION_ERROR")
    edges = sorted(data.get("edges", []), key=lambda e: -float(e.get("dependence_measure") or 0))
    return {
        **_log_label(log),
        "threshold": threshold,
        "object_types": data.get("object_types", []),
        "activities": sorted(data.get("activities", []), key=lambda a: -int(a.get("count") or 0)),
        "edge_count": len(edges),
        "edges": [
            {
                "from": e.get("source"),
                "to": e.get("target"),
                "object_type": e.get("object_type"),
                "dependence": round(float(e.get("dependence_measure") or 0), 3),
            }
            for e in edges[:80]
        ],
        "edges_truncated": len(edges) > 80,
        "input_binding_groups": {k: len(v) for k, v in (data.get("input_marker_groups") or {}).items()},
        "output_binding_groups": {k: len(v) for k, v in (data.get("output_marker_groups") or {}).items()},
    }


def discover_process_areas(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    from api.views import _serialize_mlpa
    from totem_lib.totem import mlpaDiscovery, totemDiscovery_db

    log = _resolve_log(ctx, args)
    with _ocel(log) as db:
        try:
            totem = totemDiscovery_db(db)
            data = _serialize_mlpa(mlpaDiscovery(totem), totem)
        except Exception as exc:
            raise ToolError(
                f"Process-area (MLPA) discovery failed: {exc}",
                code="EXECUTION_ERROR",
                hint="This algorithm needs the CBC linear-programming solver on the server.",
            )
    return {**_log_label(log), "process_areas": data}


def list_dashboards(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    user = _require_user(ctx)
    project_id = args.get("project_id", ctx.project_id)
    dashboards = DashboardService.list_dashboards(user=user, project_id=project_id)
    return {
        "project_id": project_id,
        "dashboards": [
            {"dashboard_id": d["id"], "name": d["name"], "components": d["component_count"], "open_in_ui": d["id"] == ctx.dashboard_id}
            for d in dashboards
        ],
    }


def get_dashboard(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    user = _require_user(ctx)
    dashboard_id = args.get("dashboard_id", ctx.dashboard_id)
    if dashboard_id is None:
        raise ToolError("No dashboard is open and no dashboard_id was given.", code="INVALID_ARGUMENT", hint="Call list_dashboards.")
    try:
        d = DashboardService.get_dashboard(user, int(dashboard_id))
    except PermissionError as exc:
        raise ToolError(str(exc), code="NOT_FOUND")
    keep = {"id", "component_name", "x", "y", "w", "h", "text", "file_id", "leading_object_type", "object_types"}
    return {
        "dashboard_id": d["id"],
        "name": d["name"],
        "project_id": d["project_id"],
        "components": [
            {("component_id" if k == "id" else k): v for k, v in comp.items() if k in keep}
            for comp in d.get("components", [])
        ],
    }


def list_assets(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    user = _require_user(ctx)
    qs = ProjectAsset.objects.filter(project__users=user)
    project_id = args.get("project_id", ctx.project_id)
    if project_id is not None:
        qs = qs.filter(project_id=project_id)
    if args.get("asset_type"):
        qs = qs.filter(asset_type=args["asset_type"])
    return {
        "assets": [
            {"asset_id": a.id, "name": a.name, "asset_type": a.asset_type, "project_id": a.project_id}
            for a in qs.order_by("-id")[:100]
        ]
    }


# -----------------------------------------------------------------------------
# Proposed (approval-gated) dashboard changes
# -----------------------------------------------------------------------------

COMPONENT_CATALOG: Dict[str, str] = {
    "LogStatisticsComponent": "KPI header: number of events, activities, objects, object types (good at w=12,h=2).",
    "NewOCDFGComponent": "Object-centric directly-follows graph (process map).",
    "VariantsComponent": "Process variants explorer. props: leading_object_type, extraction.",
    "OCDottedChartComponent": "Dotted chart of events over time. props: file_id, x_axis, y_axis, color_by.",
    "OCCNComponent": "Object-centric causal net. props: relative_occurrence_threshold, object_types.",
    "ProcessAreaComponent": "TOTeM process areas (multi-level process architecture).",
    "OCPNComponent": "Object-centric Petri net.",
    "NumberofEventsComponent": "Single number: event count. props: color.",
    "TextBoxComponent": "Markdown/text note. props: text, font_size.",
    "ImageComponent": "Static image. props: image.",
}

_CATALOG_TEXT = "; ".join(f"{k}: {v}" for k, v in COMPONENT_CATALOG.items())

_COMPONENT_ITEM = _obj(
    {
        "component_name": {"type": "string", "enum": list(COMPONENT_CATALOG)},
        "x": {"type": "integer", "minimum": 0, "maximum": 11, "description": "Grid column (12 columns)."},
        "y": {"type": "integer", "minimum": 0},
        "w": {"type": "integer", "minimum": 1, "maximum": 12},
        "h": {"type": "integer", "minimum": 1, "maximum": 20},
        "props": {"type": "object", "description": "Component-specific settings."},
    },
    ["component_name"],
)


def _dashboard_project(ctx: ToolContext, args: Dict[str, Any]) -> Optional[int]:
    if args.get("project_id") is not None:
        return int(args["project_id"])
    if ctx.project_id is not None:
        return int(ctx.project_id)
    if ctx.active_file_id is not None:
        log = EventLog.objects.filter(id=ctx.active_file_id, project__users=ctx.user).first()
        if log:
            return log.project_id
    return None


def _service_call(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except (PermissionError, ValueError) as exc:
        raise ToolError(str(exc), code="REJECTED")


def create_dashboard(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    user = _require_user(ctx)
    layout = []
    for item in args.get("components") or []:
        entry = dict(item)
        props = dict(entry.pop("props", None) or {})
        if entry["component_name"] == "OCDottedChartComponent" and "file_id" not in props and ctx.active_file_id:
            props["file_id"] = ctx.active_file_id
        layout.append({**{"x": 0, "y": 0, "w": 6, "h": 6}, **entry, "props": props})
    d = _service_call(
        DashboardService.create_dashboard,
        user=user,
        title=args["name"],
        project_id=_dashboard_project(ctx, args),
        layout=layout,
    )
    return {"dashboard_id": d["id"], "name": d["name"], "components": len(d.get("components", []))}


def add_component(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    user = _require_user(ctx)
    props = dict(args.get("props") or {})
    if args["component_name"] == "OCDottedChartComponent" and "file_id" not in props and ctx.active_file_id:
        props["file_id"] = ctx.active_file_id
    comp = _service_call(
        DashboardService.add_component,
        user=user,
        dashboard_id=int(args["dashboard_id"]),
        component_type=args["component_name"],
        config=props,
        position={k: args.get(k, d) for k, d in (("x", 0), ("y", 0), ("w", 6), ("h", 6))},
    )
    return {"dashboard_id": int(args["dashboard_id"]), "component_id": comp.get("id"), "component_name": comp.get("component_name")}


def update_component(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    user = _require_user(ctx)
    position = {k: args[k] for k in ("x", "y", "w", "h") if k in args} or None
    comp = _service_call(
        DashboardService.update_component,
        user=user,
        dashboard_id=args.get("dashboard_id"),
        component_id=int(args["component_id"]),
        config=args.get("props"),
        position=position,
    )
    return {"component_id": comp.get("id", args["component_id"]), "updated": True}


def remove_component(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    user = _require_user(ctx)
    return _service_call(
        DashboardService.remove_component,
        user=user,
        dashboard_id=args.get("dashboard_id"),
        component_id=int(args["component_id"]),
    )


def rename_dashboard(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    user = _require_user(ctx)
    d = _service_call(DashboardService.rename_dashboard, user=user, dashboard_id=int(args["dashboard_id"]), title=args["name"])
    return {"dashboard_id": d.get("id", args["dashboard_id"]), "name": d.get("name", args["name"])}


def delete_dashboard(ctx: ToolContext, args: Dict[str, Any]) -> Dict[str, Any]:
    user = _require_user(ctx)
    return _service_call(DashboardService.delete_dashboard, user=user, dashboard_id=int(args["dashboard_id"]))


# -----------------------------------------------------------------------------
# Catalog
# -----------------------------------------------------------------------------

VIEWS = ["overview", "analysis", "conformance", "playout", "editor", "model_assets", "dashboard"]
ANALYSIS_COMPONENTS = ["ocdfg", "variants", "dotted_chart", "occn", "process_area"]

TOOLS: List[Tool] = [
    Tool(
        "list_event_logs",
        "List the event logs (OCEL files) the user can access, with ids, file names and projects. "
        "Use it to resolve which log the user means or when no log is selected.",
        _obj({}),
        ToolKind.READ,
        list_event_logs,
        describe=lambda a: "Listing event logs",
    ),
    Tool(
        "get_log_overview",
        "Summary of one event log: event/object/activity counts, time range, per-object-type counts and "
        "lifecycle durations, most frequent activities, and the table schema for query_event_log. "
        "Call this first when you need facts about a log.",
        _obj({"file_id": _FILE_ID}),
        ToolKind.READ,
        get_log_overview,
        describe=lambda a: "Reading log overview",
    ),
    Tool(
        "get_activity_stats",
        "Per-activity frequencies with share, first/last occurrence, average objects per event and the "
        "object types involved. Optionally restricted to events touching one object type.",
        _obj(
            {
                "file_id": _FILE_ID,
                "object_type": {"type": "string", "description": "Only count events linked to this object type."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
            }
        ),
        ToolKind.READ,
        get_activity_stats,
        describe=lambda a: "Computing activity statistics",
    ),
    Tool(
        "get_directly_follows",
        "Directly-follows relations for one object type: for each pair of consecutive activities in an "
        "object's lifecycle, the frequency and the median/mean/max waiting time between them, plus start and "
        "end activities. Use it for flow, rework and bottleneck questions.",
        _obj(
            {
                "file_id": _FILE_ID,
                "object_type": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 40},
            },
            ["object_type"],
        ),
        ToolKind.READ,
        get_directly_follows,
        describe=lambda a: f"Computing directly-follows for {a.get('object_type', '')}",
    ),
    Tool(
        "query_event_log",
        "Run one read-only DuckDB SELECT over the event log for questions the other tools don't answer. "
        "Tables: events(event_id, activity, timestamp_unix BIGINT seconds UTC, ...attributes), "
        "event_object(event_id, obj_id, qualifier), objects(obj_id, obj_type, ...attributes), "
        "object_attribute_history(obj_id, timestamp_unix, ...), object_relations(source_obj_id, target_obj_id, qualifier). "
        "Attribute columns differ per log; get_log_overview lists them. Aggregate in SQL; at most 200 rows come back.",
        _obj(
            {
                "file_id": _FILE_ID,
                "sql": {"type": "string", "description": "A single SELECT statement (CTEs allowed)."},
                "max_rows": {"type": "integer", "minimum": 1, "maximum": 200, "default": 100},
            },
            ["sql"],
        ),
        ToolKind.READ,
        query_event_log,
        describe=lambda a: "Querying the event log",
    ),
    Tool(
        "find_variants",
        "Mine object-centric process variants (distinct execution graphs) and return the most frequent ones "
        "with case counts, share and activity sequence. Can take several seconds on large logs.",
        _obj(
            {
                "file_id": _FILE_ID,
                "leading_object_type": {"type": "string", "description": "Case notion; required for leading_* extraction."},
                "extraction": {"type": "string", "enum": ["leading_1hop", "leading_bfs", "connected"], "default": "leading_1hop"},
                "top_k": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
                "timeout_s": {"type": "number", "minimum": 1, "maximum": 60, "default": 20},
            }
        ),
        ToolKind.READ,
        find_variants_tool,
        describe=lambda a: f"Mining variants ({a.get('leading_object_type') or a.get('extraction', 'connected')})",
    ),
    Tool(
        "discover_totem",
        "Discover the TOTeM model: temporal relations between object types (during / initiating / parallel), "
        "log and event cardinalities between object types, and the activities of each object type.",
        _obj({"file_id": _FILE_ID, "tau": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.9}}),
        ToolKind.READ,
        discover_totem,
        describe=lambda a: "Discovering the TOTeM model",
    ),
    Tool(
        "discover_occn",
        "Discover the object-centric causal net (OCCN): activity counts, the strongest causal dependencies "
        "per object type, and binding group sizes. Slower on large logs.",
        _obj(
            {
                "file_id": _FILE_ID,
                "threshold": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.0},
                "object_types": {"type": "array", "items": {"type": "string"}},
            }
        ),
        ToolKind.READ,
        discover_occn,
        describe=lambda a: "Discovering the causal net",
    ),
    Tool(
        "discover_process_areas",
        "Discover TOTeM process areas (multi-level process architecture): object types grouped into levels.",
        _obj({"file_id": _FILE_ID}),
        ToolKind.READ,
        discover_process_areas,
        describe=lambda a: "Discovering process areas",
    ),
    Tool(
        "list_dashboards",
        "List dashboards of the current project (or a given project) with ids and component counts.",
        _obj({"project_id": {"type": "integer"}}),
        ToolKind.READ,
        list_dashboards,
        describe=lambda a: "Listing dashboards",
    ),
    Tool(
        "get_dashboard",
        "Components of one dashboard (ids, types, grid positions). Needed before updating or removing components.",
        _obj({"dashboard_id": {"type": "integer", "description": "Defaults to the dashboard open in the UI."}}),
        ToolKind.READ,
        get_dashboard,
        describe=lambda a: "Reading dashboard",
    ),
    Tool(
        "list_assets",
        "List saved model assets (TOTeM / OCCN models) of the project.",
        _obj({"project_id": {"type": "integer"}, "asset_type": {"type": "string", "enum": ["TOTEM", "OCCN"]}}),
        ToolKind.READ,
        list_assets,
        describe=lambda a: "Listing model assets",
    ),
    # --- approval-gated changes (act mode only) -------------------------------
    Tool(
        "create_dashboard",
        "Propose creating a dashboard with initial components on a 12-column grid. The user must approve "
        "before it is created. Components: " + _CATALOG_TEXT,
        _obj(
            {
                "name": {"type": "string", "minLength": 1, "maxLength": 30},
                "components": {"type": "array", "items": _COMPONENT_ITEM, "maxItems": 12},
                "project_id": {"type": "integer"},
            },
            ["name"],
        ),
        ToolKind.PROPOSE,
        create_dashboard,
        modes=frozenset({"act"}),
        describe=lambda a: f"Create dashboard \"{a.get('name', '')}\" with {len(a.get('components') or [])} components",
    ),
    Tool(
        "add_component",
        "Propose adding one component to a dashboard (user approval required). Components: " + _CATALOG_TEXT,
        _obj(
            {
                "dashboard_id": {"type": "integer"},
                "component_name": {"type": "string", "enum": list(COMPONENT_CATALOG)},
                "x": {"type": "integer", "minimum": 0, "maximum": 11},
                "y": {"type": "integer", "minimum": 0},
                "w": {"type": "integer", "minimum": 1, "maximum": 12},
                "h": {"type": "integer", "minimum": 1, "maximum": 20},
                "props": {"type": "object"},
            },
            ["dashboard_id", "component_name"],
        ),
        ToolKind.PROPOSE,
        add_component,
        modes=frozenset({"act"}),
        describe=lambda a: f"Add {a.get('component_name', 'component')} to dashboard {a.get('dashboard_id')}",
    ),
    Tool(
        "update_component",
        "Propose moving/resizing a component or changing its settings (user approval required).",
        _obj(
            {
                "component_id": {"type": "integer"},
                "dashboard_id": {"type": "integer"},
                "x": {"type": "integer", "minimum": 0, "maximum": 11},
                "y": {"type": "integer", "minimum": 0},
                "w": {"type": "integer", "minimum": 1, "maximum": 12},
                "h": {"type": "integer", "minimum": 1, "maximum": 20},
                "props": {"type": "object"},
            },
            ["component_id"],
        ),
        ToolKind.PROPOSE,
        update_component,
        modes=frozenset({"act"}),
        describe=lambda a: f"Update component {a.get('component_id')}",
    ),
    Tool(
        "remove_component",
        "Propose removing a component from a dashboard (user approval required).",
        _obj({"component_id": {"type": "integer"}, "dashboard_id": {"type": "integer"}}, ["component_id"]),
        ToolKind.PROPOSE,
        remove_component,
        modes=frozenset({"act"}),
        describe=lambda a: f"Remove component {a.get('component_id')}",
    ),
    Tool(
        "rename_dashboard",
        "Propose renaming a dashboard (user approval required).",
        _obj({"dashboard_id": {"type": "integer"}, "name": {"type": "string", "minLength": 1, "maxLength": 30}}, ["dashboard_id", "name"]),
        ToolKind.PROPOSE,
        rename_dashboard,
        modes=frozenset({"act"}),
        describe=lambda a: f"Rename dashboard {a.get('dashboard_id')} to \"{a.get('name', '')}\"",
    ),
    Tool(
        "delete_dashboard",
        "Propose deleting a dashboard and all its components (user approval required; cannot be undone).",
        _obj({"dashboard_id": {"type": "integer"}}, ["dashboard_id"]),
        ToolKind.PROPOSE,
        delete_dashboard,
        modes=frozenset({"act"}),
        describe=lambda a: f"Delete dashboard {a.get('dashboard_id')}",
    ),
    # --- browser-side actions --------------------------------------------------
    Tool(
        "open_view",
        "Switch the app to a view so the user can see it: overview, analysis (with component ocdfg / variants / "
        "dotted_chart / occn / process_area), conformance (component totem / occn), playout, editor, model_assets, "
        "or dashboard (with dashboard_id). Runs immediately in the user's browser. It only switches the view: it "
        "cannot preselect object types, filters or other settings inside it, so tell the user what to pick there.",
        _obj(
            {
                "view": {"type": "string", "enum": VIEWS},
                "component": {"type": "string", "enum": ANALYSIS_COMPONENTS + ["totem", "ocpn"]},
                "dashboard_id": {"type": "integer"},
            },
            ["view"],
        ),
        ToolKind.CLIENT,
        modes=frozenset({"act"}),
        describe=lambda a: f"Open {a.get('view')}" + (f" › {a['component']}" if a.get("component") else ""),
    ),
    Tool(
        "start_tour",
        "Show the user where things are with a guided, step-by-step spotlight tour over UI elements. "
        "Each step names a tour_id from the catalog in the instructions and a short instruction.",
        _obj(
            {
                "steps": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 10,
                    "items": _obj(
                        {"tour_id": {"type": "string"}, "label": {"type": "string", "maxLength": 200}},
                        ["tour_id", "label"],
                    ),
                }
            },
            ["steps"],
        ),
        ToolKind.CLIENT,
        describe=lambda a: f"Guided tour ({len(a.get('steps') or [])} steps)",
    ),
]

TOOLS_BY_NAME: Dict[str, Tool] = {t.name: t for t in TOOLS}


def get_tools(mode: str) -> List[Tool]:
    """Tools offered in a chat mode, in a stable order (keeps prompt caches warm)."""
    return [t for t in TOOLS if mode in t.modes]


def get_tool_specs(mode: str = "act") -> List[Dict[str, Any]]:
    return [t.spec() for t in get_tools(mode)]


def validate_arguments(tool: Tool, args: Any) -> Dict[str, Any]:
    """Validate model-supplied arguments against the tool schema; raise ToolError on mismatch."""
    if not isinstance(args, dict):
        raise ToolError("Arguments must be a JSON object.", code="INVALID_ARGUMENT")
    try:
        jsonschema.validate(args, tool.parameters)
    except jsonschema.ValidationError as exc:
        where = "/".join(str(p) for p in exc.absolute_path) or "arguments"
        raise ToolError(f"Invalid {where}: {exc.message}", code="INVALID_ARGUMENT")
    return args


def call_tool(name: str, arguments: Optional[Dict[str, Any]], ctx: ToolContext) -> Dict[str, Any]:
    """Validate and run a READ or PROPOSE tool. Raises ToolError for expected failures."""
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        raise ToolError(f"Unknown tool '{name}'.", code="UNKNOWN_TOOL")
    if tool.handler is None:
        raise ToolError(f"Tool '{name}' runs in the browser, not on the server.", code="CLIENT_TOOL")
    args = validate_arguments(tool, arguments if arguments is not None else {})
    return tool.handler(ctx, args)
