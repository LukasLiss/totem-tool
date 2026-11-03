"""Export and import a dashboard's structure as a portable JSON document.

A bundle carries layout and widget configuration — never event data. The
rendering of a dashboard is a function of whatever OCEL log the target project
holds, so an imported dashboard legitimately looks different; what matters is
that nothing silently points at the *source* project's rows.

Three kinds of field need care, and they are the only ones:

1. ``query_asset`` / ``image_asset`` are foreign keys into one project. They
   travel **by name** (``query_asset_name`` / ``image_asset_name``) and are
   resolved against the target project on import. A name that is not there
   unlinks, which for the query widgets means falling back to the inline
   ``query`` text the component already carries — the SQL stays visible and
   editable, which is the point.
2. ``OCDottedChartComponent.file_id`` is a raw ``EventLog`` pk. It is dropped on
   export and re-pointed at the target log on import.
3. ``TextBoxComponent.rich_text`` may carry ``dashboardLink`` marks holding a
   dashboard id. Those are rewritten to the **target dashboard's name** on
   export and resolved back on import.

   Exporting the raw id and letting ``validated_rich_text`` filter it is not
   safe, even though it looks like it would be: ``_clean_dashboard_id`` keeps
   an id that is present in the project being saved into. Within one database
   that is harmless — a link always pointed at a dashboard of its own project,
   so a foreign project cannot contain that id. Across *installations* it is
   not: a file exported on one machine and imported on another meets a
   database where id 5 is some unrelated dashboard of the target project, and
   the link silently re-points at it. Sharing dashboards between installs is
   the whole point of a file, so names it is.

The import path deliberately produces a plain ``layout`` list in the shape
``DashboardViewSet.save_layout`` already accepts, so the whole per-field
validation and clamping chain in ``_replace_components`` is reused unchanged.
A future whole-project importer should call :func:`resolve_bundle_components`
per dashboard for the same reason.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .models import Dashboard, ImageAsset, ProjectAsset

DASHBOARD_BUNDLE_SCHEMA = "totem-dashboard"
DASHBOARD_BUNDLE_VERSION = 1

# The names `_replace_components` can actually write — its `if/elif` chain is
# the authority, not `_LAYOUT_COMPONENT_MODELS` (which is the *read* path and
# spells NumberOfEvents differently). Kept as a literal rather than an import to
# avoid a cycle (the viewset imports this module); a test asserts the two stay
# in step, because a widget in one and not the other vanishes silently.
KNOWN_COMPONENT_NAMES = frozenset(
    {
        "TextBoxComponent",
        "NumberOfEventsComponent",
        "ImageComponent",
        "VariantsComponent",
        "ProcessAreaComponent",
        "TotemMinerComponent",
        "LogStatisticsComponent",
        "OCDottedChartComponent",
        "NewOCDFGComponent",
        "NewOCDFGVariantsComponent",
        "OCPNComponent",
        "SqlQueryComponent",
        "PieChartComponent",
        "KpiComponent",
        "BarChartComponent",
        "ScatterPlotComponent",
        "OCCNComponent",
        "FilterStackComponent",
        "OCHandoverComponent",
        "ResourceProfilingComponent",
    }
)

# Warning codes returned by an import. Stable strings: the frontend groups on
# them, so renaming one is a breaking change.
WARN_QUERY_ASSET_MISSING = "query_asset_missing"
WARN_IMAGE_ASSET_MISSING = "image_asset_missing"
WARN_DASHBOARD_LINK_DROPPED = "dashboard_link_dropped"
WARN_COMPONENT_UNKNOWN = "component_unknown"
WARN_EVENT_LOG_REBOUND = "event_log_rebound"
WARN_EVENT_LOG_MISSING = "event_log_missing"

# Row identity and the polymorphic discriminator. `component_name` is the
# dispatch key `_replace_components` switches on, so `resourcetype` carries
# nothing extra and would only be a second thing to keep in step.
_CONTAINER_KEYS = ("id", "dashboard", "resourcetype")

# Derived or project-local, never portable: `image_asset_url` is resolved from
# the asset, and `image` is a legacy path confined to one project's media dir.
_DERIVED_KEYS = ("image_asset_url", "image")


# A hand-edited file should not be able to ask for a hundred thousand rows.
# `save_layout` has no such cap because its payload comes from a grid the user
# built by hand; a file is less trusted than that.
MAX_BUNDLE_COMPONENTS = 200


def _require(condition, message):
    """Raise ``ValueError`` when ``condition`` is false.

    Matches the house style in ``asset_formats.py`` so the view can turn one
    exception type into a clean 400.
    """
    if not condition:
        raise ValueError(message)


# ---------------------------------------------------------------------------
# Dashboard links inside rich text
# ---------------------------------------------------------------------------


def _map_dashboard_links(node, rewrite):
    """Walk a rich-text document, replacing every ``dashboardLink`` mark.

    ``rewrite(attrs)`` returns the new attrs, or ``None`` to drop the mark and
    keep the text it covered. Returns a new document; the input is untouched.
    """
    if isinstance(node, list):
        return [_map_dashboard_links(child, rewrite) for child in node]
    if not isinstance(node, dict):
        return node

    out = dict(node)

    marks = out.get("marks")
    if isinstance(marks, list):
        kept = []
        for mark in marks:
            if isinstance(mark, dict) and mark.get("type") == "dashboardLink":
                attrs = rewrite(mark.get("attrs") or {})
                if attrs is None:
                    continue
                mark = {**mark, "attrs": attrs}
            kept.append(mark)
        out["marks"] = kept

    if "content" in out:
        out["content"] = _map_dashboard_links(out["content"], rewrite)

    return out


def links_to_names(rich_text, id_to_name):
    """Rewrite ``dashboardId`` marks to ``dashboardName`` for export.

    A link whose target no longer exists was already dead in the UI, so it is
    dropped rather than exported as a name that resolves to nothing.
    """
    if not isinstance(rich_text, (dict, list)):
        return rich_text

    def rewrite(attrs):
        name = id_to_name.get(attrs.get("dashboardId"))
        return {"dashboardName": name} if name else None

    return _map_dashboard_links(rich_text, rewrite)


def links_to_ids(rich_text, name_to_id):
    """Rewrite ``dashboardName`` marks back to ids. Returns ``(doc, dropped)``."""
    if not isinstance(rich_text, (dict, list)):
        return rich_text, 0

    dropped = [0]

    def rewrite(attrs):
        link_id = name_to_id.get(attrs.get("dashboardName"))
        if link_id is None:
            dropped[0] += 1
            return None
        return {"dashboardId": link_id}

    return _map_dashboard_links(rich_text, rewrite), dropped[0]


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


def _serialized_components(dashboard):
    """The dashboard's components, downcast and serialized.

    Deliberately the same read path as ``DashboardViewSet.get_layout`` so an
    export can never disagree with what the grid loads, but ordered: the
    viewset relies on row order, which is fine for a grid that positions by
    x/y but makes for a needlessly unstable file.
    """
    # Imported here: views/dashboards.py imports this module, and serializers
    # pulls in the whole model graph.
    from .serializers import DashboardComponentPolymorphicSerializer
    from .views.dashboards import DashboardViewSet

    models_by_name = DashboardViewSet._LAYOUT_COMPONENT_MODELS
    components = []
    for comp in dashboard.components.all().order_by("order", "id"):
        model = models_by_name.get(comp.component_name)
        components.append(model.objects.get(id=comp.id) if model else comp)
    return DashboardComponentPolymorphicSerializer(components, many=True).data


def _referenced_assets(rows):
    """Name and SQL of the query assets, and names of the image assets, in use.

    Two queries rather than one per component.
    """
    query_ids = {row["query_asset"] for row in rows if row.get("query_asset")}
    image_ids = {row["image_asset"] for row in rows if row.get("image_asset")}
    queries = {
        pk: (name, (content or {}).get("query") or "")
        for pk, name, content in ProjectAsset.objects.filter(
            pk__in=query_ids
        ).values_list("pk", "name", "content_json")
    }
    image_names = dict(
        ImageAsset.objects.filter(pk__in=image_ids).values_list("pk", "name")
    )
    return queries, image_names


def _portable_component(row, queries, image_names, dashboard_names):
    """One serialized component, stripped of everything project-bound."""
    item = dict(row)

    for key in _CONTAINER_KEYS:
        item.pop(key, None)

    # The event log a dotted chart was bound to means nothing elsewhere; the
    # importer re-points it at the target project's log.
    item.pop("file_id", None)

    query_asset_id = item.pop("query_asset", None)
    if query_asset_id:
        name, asset_sql = queries.get(query_asset_id, (None, ""))
        if name:
            item["query_asset_name"] = name
        # Carry the *effective* SQL, not the inline text the link made dead.
        # When the name does not resolve in the target project the widget falls
        # back to `query`, and an empty `query` renders blank and silent
        # (`useSqlQueryData` treats no SQL as "no error, no rows") — which would
        # hide exactly the breakage the user needs to see.
        if asset_sql:
            item["query"] = asset_sql

    image_asset_id = item.pop("image_asset", None)
    if image_asset_id:
        name = image_names.get(image_asset_id)
        if name:
            item["image_asset_name"] = name

    if "rich_text" in item:
        item["rich_text"] = links_to_names(item["rich_text"], dashboard_names)

    for key in _DERIVED_KEYS:
        item.pop(key, None)

    return item


def build_dashboard_bundle(dashboard):
    """A portable document describing ``dashboard``'s structure."""
    rows = _serialized_components(dashboard)
    queries, image_names = _referenced_assets(rows)
    # Link targets travel as names; see the module docstring for why ids are
    # not safe to put in a file.
    dashboard_names = dict(
        Dashboard.objects.filter(project_id=dashboard.project_id).values_list(
            "id", "name"
        )
    )

    return {
        "schema": DASHBOARD_BUNDLE_SCHEMA,
        "version": DASHBOARD_BUNDLE_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        # Provenance only — never read on import. It is here so somebody
        # holding the file months later can tell where it came from.
        "source": {
            "dashboard_name": dashboard.name,
            "project_name": dashboard.project.display_name or dashboard.project.name,
        },
        "dashboard": {"name": dashboard.name},
        "components": [
            _portable_component(row, queries, image_names, dashboard_names)
            for row in rows
        ],
    }


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_dashboard_bundle_dict(raw):
    """Check ``raw`` is a dashboard bundle this version can read.

    Raises ``ValueError`` with a message meant for the user. Structural only:
    per-field validation belongs to ``_replace_components``, which runs over
    every layout whatever its origin.
    """
    _require(isinstance(raw, dict), "The file must contain a JSON object.")

    schema = raw.get("schema")
    _require(
        schema == DASHBOARD_BUNDLE_SCHEMA,
        f'Not a dashboard file (expected schema "{DASHBOARD_BUNDLE_SCHEMA}", '
        f"found {schema!r}).",
    )

    version = raw.get("version")
    _require(
        isinstance(version, int) and not isinstance(version, bool),
        "The file's version must be a whole number.",
    )
    _require(
        1 <= version <= DASHBOARD_BUNDLE_VERSION,
        f"This file was written by a newer version of TOTeM (dashboard format "
        f"{version}; this build reads up to {DASHBOARD_BUNDLE_VERSION}).",
    )

    dashboard = raw.get("dashboard")
    _require(isinstance(dashboard, dict), "The file is missing its dashboard block.")
    name = dashboard.get("name")
    _require(
        isinstance(name, str) and name.strip(),
        "The file is missing a dashboard name.",
    )

    components = raw.get("components")
    _require(isinstance(components, list), "The file's components must be a list.")
    _require(
        len(components) <= MAX_BUNDLE_COMPONENTS,
        f"The file describes {len(components)} widgets; at most "
        f"{MAX_BUNDLE_COMPONENTS} can be imported at once.",
    )
    for index, item in enumerate(components):
        _require(isinstance(item, dict), f"Component {index + 1} is not an object.")
        _require(
            isinstance(item.get("component_name"), str),
            f"Component {index + 1} is missing its type.",
        )
        for key in ("x", "y", "w", "h"):
            value = item.get(key)
            _require(
                isinstance(value, int) and not isinstance(value, bool),
                f"Component {index + 1} has a non-numeric {key}.",
            )


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


def unique_dashboard_name(project, desired):
    """A free dashboard name in ``project`` based on ``desired``.

    Import never overwrites, so a clash is resolved by suffixing rather than
    asking. ``Dashboard.name`` caps at 30 characters, so the base is trimmed to
    leave room for the suffix instead of letting the database reject the row.
    """
    limit = Dashboard._meta.get_field("name").max_length
    base = (desired or "").strip()[:limit] or "Imported dashboard"[:limit]

    taken = set(
        Dashboard.objects.filter(project=project).values_list("name", flat=True)
    )
    if base not in taken:
        return base

    for suffix in [" (imported)"] + [f" ({n})" for n in range(2, 100)]:
        candidate = base[: limit - len(suffix)].rstrip() + suffix
        if candidate not in taken:
            return candidate

    # 99 collisions on one name: fall back to something certainly free rather
    # than raising at the end of an otherwise valid import.
    return base[: limit - 14].rstrip() + f" ({Dashboard.objects.count() + 1})"


def resolve_bundle_components(
    components,
    *,
    project,
    user,
    event_log_id=None,
    self_dashboard=None,
    self_name=None,
):
    """Turn bundle components into a ``save_layout``-shaped layout.

    Returns ``(layout, warnings)``. The layout uses the id-shaped keys
    (``query_asset``, ``image_asset``, ``file_id``) that ``_replace_components``
    already reads, so no change to that chain is needed. Warnings describe
    everything that did not survive the move, because the existing write path
    degrades silently by design and the user needs to know what to fix.

    ``self_dashboard`` is the dashboard being filled and ``self_name`` the name
    it had *in the file*. A link naming the bundle's own dashboard resolves to
    the new copy rather than to whatever already holds that name, so importing a
    self-linking dashboard gives a copy that links to itself. Keying on the
    file's name matters: the copy has usually been renamed by the clash
    suffixing, and the original it clashed with is exactly what the link must
    not point at.
    """
    layout = []
    warnings = []

    # Scoped exactly as `_query_asset_for` scopes its id lookup: an asset of
    # this project that this user can see.
    query_assets = {
        name: pk
        for pk, name in ProjectAsset.objects.filter(
            project=project,
            project__users=user,
            asset_type=ProjectAsset.AssetType.QUERY,
        ).values_list("pk", "name")
    }
    image_assets = {
        name: pk
        for pk, name in ImageAsset.objects.filter(
            project=project, project__users=user
        ).values_list("pk", "name")
    }
    dashboard_ids = {
        name: pk
        for pk, name in Dashboard.objects.filter(project=project).values_list(
            "pk", "name"
        )
    }
    if self_dashboard is not None:
        dashboard_ids[self_name or self_dashboard.name] = self_dashboard.pk

    for item in components:
        name = item.get("component_name")

        if name not in KNOWN_COMPONENT_NAMES:
            warnings.append(
                {
                    "code": WARN_COMPONENT_UNKNOWN,
                    "component_name": name,
                    "detail": (
                        f'This build does not know a widget called "{name}", so it '
                        f"was left out. The file may come from a newer version of "
                        f"TOTeM."
                    ),
                }
            )
            continue

        resolved = dict(item)

        asset_name = resolved.pop("query_asset_name", None)
        if asset_name:
            asset_id = query_assets.get(asset_name)
            if asset_id:
                resolved["query_asset"] = asset_id
            else:
                warnings.append(
                    {
                        "code": WARN_QUERY_ASSET_MISSING,
                        "component_name": name,
                        "detail": (
                            f'No stored query called "{asset_name}" in this project, '
                            f"so the widget kept its own copy of the SQL. That copy "
                            f"is a snapshot, and it may name columns or stored "
                            f"queries this event log does not have — the widget will "
                            f"show the error so you can edit it."
                        ),
                    }
                )

        image_name = resolved.pop("image_asset_name", None)
        if image_name:
            asset_id = image_assets.get(image_name)
            if asset_id:
                resolved["image_asset"] = asset_id
            else:
                warnings.append(
                    {
                        "code": WARN_IMAGE_ASSET_MISSING,
                        "component_name": name,
                        "detail": (
                            f'No image called "{image_name}" in this project, so the '
                            f"widget imported empty. Upload the image under Project "
                            f"Assets with that name, or pick another one."
                        ),
                    }
                )

        if name == "OCDottedChartComponent":
            if event_log_id:
                resolved["file_id"] = event_log_id
                warnings.append(
                    {
                        "code": WARN_EVENT_LOG_REBOUND,
                        "component_name": name,
                        "detail": (
                            "The dotted chart was re-pointed at this project's event "
                            "log. Its axis and colour settings name columns from the "
                            "old log, so check them."
                        ),
                    }
                )
            else:
                resolved.pop("file_id", None)
                warnings.append(
                    {
                        "code": WARN_EVENT_LOG_MISSING,
                        "component_name": name,
                        "detail": (
                            "The dotted chart needs an event log and none was "
                            "selected, so it imported unbound. Open it and pick one."
                        ),
                    }
                )

        if "rich_text" in resolved:
            resolved["rich_text"], dropped = links_to_ids(
                resolved["rich_text"], dashboard_ids
            )
            if dropped:
                warnings.append(
                    {
                        "code": WARN_DASHBOARD_LINK_DROPPED,
                        "component_name": name,
                        "detail": (
                            f"A text box linked to {dropped} dashboard(s) that are "
                            f"not in this project. The words stayed, the links were "
                            f"removed."
                        ),
                    }
                )

        layout.append(resolved)

    return layout, warnings
