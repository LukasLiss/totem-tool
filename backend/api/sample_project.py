"""First-launch sample project.

A fresh install has no event log, so every Analysis, Conformance and dashboard
view renders empty until the user finds and uploads an OCEL file. This module
seeds one ready-made project -- a container-logistics event log, a company logo
and a dashboard built on top of them -- so the app has something to show the
first time it opens.

It runs from ``post_migrate`` (wired in ``api/apps.py``), which the desktop app
triggers on every launch via ``migrate --noinput``. That makes "run exactly
once" a real requirement rather than a nicety: see :class:`api.models.SeedState`
for how a completed seed is remembered, including after the user deletes what
it created.

Gated by ``settings.SEED_SAMPLE_PROJECT`` -- desktop installs only, never a
hosted deployment, and never under the test runner.
"""

import logging
import sys
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files import File
from django.core.files.base import ContentFile
from django.db import connection, transaction

from .asset_formats import SQL_QUERY_ASSET_SCHEMA, SQL_QUERY_ASSET_VERSION
from .rich_text import plain_text_from_doc

logger = logging.getLogger(__name__)

# One row in SeedState under this key means the sample project has been
# provisioned. It is never removed, so a deleted sample stays deleted.
SAMPLE_SEED_KEY = "sample_project"

SAMPLE_LOG_FILENAME = "container_logistics.duckdb"
SAMPLE_LOGO_FILENAME = "meridian-freight-logo.svg"

# Meridian Freight Systems is a fictional company invented for this sample.
SAMPLE_PROJECT_NAME = "container-logistics-demo"      # also an upload directory
SAMPLE_PROJECT_DISPLAY_NAME = "Meridian Freight Systems — Container Operations"
SAMPLE_DASHBOARD_NAME = "Container Ops Overview"      # Dashboard.name caps at 30
SAMPLE_LOGO_ASSET_NAME = "Meridian Freight Logo"

# A stylised shipping container: Deep Blue body, Slate ridges and wordmark, an
# Amber handling accent and an Emerald route swoosh -- the four object-type
# colours from docs/totem_design_system.md.
SAMPLE_LOGO_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240" role="img" aria-label="Meridian Freight Systems">
  <rect x="40" y="62" width="160" height="88" rx="6" fill="#2563EB"/>
  <rect x="40" y="62" width="160" height="88" rx="6" fill="none" stroke="#1E293B" stroke-width="4"/>
  <line x1="72" y1="62" x2="72" y2="150" stroke="#1E293B" stroke-width="3"/>
  <line x1="104" y1="62" x2="104" y2="150" stroke="#1E293B" stroke-width="3"/>
  <line x1="136" y1="62" x2="136" y2="150" stroke="#1E293B" stroke-width="3"/>
  <line x1="168" y1="62" x2="168" y2="150" stroke="#1E293B" stroke-width="3"/>
  <circle cx="190" cy="52" r="11" fill="#F59E0B"/>
  <path d="M20 178 C 66 198, 106 160, 152 178 S 218 196, 220 176"
        fill="none" stroke="#10B981" stroke-width="10" stroke-linecap="round"/>
  <text x="120" y="214" text-anchor="middle" font-family="Inter, sans-serif"
        font-size="26" font-weight="700" fill="#1E293B">MERIDIAN</text>
  <text x="120" y="232" text-anchor="middle" font-family="Inter, sans-serif"
        font-size="12" letter-spacing="2.5" fill="#64748B">FREIGHT SYSTEMS</text>
</svg>
"""

# Every query below was run against the bundled log through the same sandbox the
# SQL widgets use (ATTACH ... READ_ONLY, USE log, enable_external_access off) and
# each is a single SELECT, which /execute_query/ requires. Attribute columns in
# an OCEL DuckDB are VARCHAR whatever the source type was, so anything numeric
# taken from `objects` would need an explicit cast; these only count and join.
QUERY_CUSTOMER_ORDERS = (
    "SELECT count(*) AS value FROM objects WHERE obj_type = 'CustomerOrder'"
)

QUERY_ORDER_LEAD_TIME = """SELECT round(avg(lead) / 86400.0, 1) AS value FROM (
  SELECT eo.obj_id, max(e.timestamp_unix) - min(e.timestamp_unix) AS lead
  FROM event_object eo
  JOIN events e USING (event_id)
  JOIN objects o ON o.obj_id = eo.obj_id
  WHERE o.obj_type = 'CustomerOrder'
  GROUP BY eo.obj_id
)"""

QUERY_RESCHEDULE_RATE = """SELECT round(100.0 *
  (SELECT count(*) FROM events WHERE activity = 'RescheduleContainer') /
  (SELECT count(*) FROM objects WHERE obj_type = 'Container'), 1) AS value"""

QUERY_MONTHLY_ORDERS = """SELECT strftime(to_timestamp(min_ts), '%Y-%m') AS label,
       count(*) AS value
FROM (
  SELECT eo.obj_id, min(e.timestamp_unix) AS min_ts
  FROM event_object eo
  JOIN events e USING (event_id)
  JOIN objects o ON o.obj_id = eo.obj_id
  WHERE o.obj_type = 'CustomerOrder'
  GROUP BY eo.obj_id
)
GROUP BY label
ORDER BY label"""

# Where the work goes. Grouping the long tail keeps the donut readable: the
# raw activity list has 14 entries, and the object-type mix -- the obvious
# alternative -- is 76% handling units, which draws as a solid ring. The
# process-area widget below already shows the object types.
QUERY_ACTIVITY_WORKLOAD = """SELECT label, sum(value) AS value FROM (
  SELECT CASE WHEN rank <= 6 THEN activity ELSE 'Other activities' END AS label,
         occurrences AS value
  FROM (
    SELECT activity,
           count(*) AS occurrences,
           row_number() OVER (ORDER BY count(*) DESC) AS rank
    FROM events
    GROUP BY activity
  )
)
GROUP BY label
ORDER BY value DESC"""


# --- The project's stored SQL queries ----------------------------------------
#
# These fill the query store (Project Assets > SQL Queries) so the sample
# project arrives with the kind of saved queries an operations team would
# actually keep, and the SQL editor opens onto something real.
#
# They deliberately do not repeat the generic example library in
# frontend/src/react_component/sql/exampleQueries.ts ("Add from examples"),
# which already covers log-agnostic questions like events per activity or
# objects per type. These are about *this* business: orders, containers,
# vehicles and the exceptions in between.

QUERY_STORE_ORDER_LEAD_TIME = """SELECT eo.obj_id AS customer_order,
       to_timestamp(min(e.timestamp_unix)) AS registered_at,
       to_timestamp(max(e.timestamp_unix)) AS last_event_at,
       round((max(e.timestamp_unix) - min(e.timestamp_unix)) / 86400.0, 2) AS lead_days,
       count(*) AS recorded_steps
FROM event_object eo
JOIN events e USING (event_id)
JOIN objects o ON o.obj_id = eo.obj_id
WHERE o.obj_type = 'CustomerOrder'
GROUP BY eo.obj_id
ORDER BY lead_days DESC"""

# Builds on the stored query above by name. A stored query can be used like a
# table; the backend folds the referenced one in as a CTE before running it
# (api/query_refs.py), so the two never drift apart.
QUERY_STORE_DELAYED_ORDERS = """SELECT customer_order, registered_at, lead_days
FROM "Order Lead Time"
WHERE lead_days > 7
ORDER BY lead_days DESC"""

QUERY_STORE_CONTAINER_TURNAROUND = """SELECT eo.obj_id AS container,
       o.Status AS status,
       try_cast(o.Weight AS DOUBLE) AS weight_kg,
       to_timestamp(min(e.timestamp_unix)) AS first_seen,
       to_timestamp(max(e.timestamp_unix)) AS last_seen,
       round((max(e.timestamp_unix) - min(e.timestamp_unix)) / 3600.0, 1) AS turnaround_hours,
       count(*) AS handling_steps
FROM event_object eo
JOIN events e USING (event_id)
JOIN objects o ON o.obj_id = eo.obj_id
WHERE o.obj_type = 'Container'
GROUP BY eo.obj_id, o.Status, o.Weight
ORDER BY turnaround_hours DESC"""

QUERY_STORE_VEHICLE_LOADING = """SELECT v.obj_id AS vehicle,
       count(DISTINCT c.obj_id) AS containers_loaded,
       to_timestamp(min(e.timestamp_unix)) AS first_load,
       to_timestamp(max(e.timestamp_unix)) AS last_load
FROM events e
JOIN event_object ev ON ev.event_id = e.event_id
JOIN objects v ON v.obj_id = ev.obj_id AND v.obj_type = 'Vehicle'
JOIN event_object ec ON ec.event_id = e.event_id
JOIN objects c ON c.obj_id = ec.obj_id AND c.obj_type = 'Container'
WHERE e.activity = 'LoadtoVehicle'
GROUP BY v.obj_id
ORDER BY containers_loaded DESC"""

QUERY_STORE_RESCHEDULED = """SELECT to_timestamp(e.timestamp_unix) AS rescheduled_at,
       eo.obj_id AS container,
       o.Status AS status,
       try_cast(o.Weight AS DOUBLE) AS weight_kg
FROM events e
JOIN event_object eo ON eo.event_id = e.event_id
JOIN objects o ON o.obj_id = eo.obj_id
WHERE e.activity = 'RescheduleContainer'
  AND o.obj_type = 'Container'
ORDER BY rescheduled_at"""


# (name, description, sql). Names are what the SQL editor shows in its
# "Queries" menu, and what another query references them by -- so renaming one
# breaks any query built on it, exactly as it would for a table.
SAMPLE_QUERIES = [
    (
        "Order Lead Time",
        "One row per customer order: when it was registered, when it was last "
        "touched, and how many days it took end to end.",
        QUERY_STORE_ORDER_LEAD_TIME,
    ),
    (
        "Delayed Orders",
        "Orders that took more than a week. Built on the “Order Lead Time” "
        "query — a stored query can be used like a table.",
        QUERY_STORE_DELAYED_ORDERS,
    ),
    (
        "Container Turnaround",
        "How long each container stayed in the network, with its weight, status "
        "and how many handling steps it took.",
        QUERY_STORE_CONTAINER_TURNAROUND,
    ),
    (
        "Vehicle Loading Summary",
        "Containers loaded per vehicle, with the first and last loading time.",
        QUERY_STORE_VEHICLE_LOADING,
    ),
    (
        "Rescheduled Containers",
        "Every container that had to be rescheduled — the exception list.",
        QUERY_STORE_RESCHEDULED,
    ),
    (
        "Monthly Order Volume",
        "Customer orders registered per month. Drives the dashboard's bar chart.",
        QUERY_MONTHLY_ORDERS,
    ),
    (
        "Terminal Workload by Activity",
        "Events per activity, with the long tail grouped. Drives the dashboard's "
        "donut chart.",
        QUERY_ACTIVITY_WORKLOAD,
    ),
]

# Dashboard widgets that link a stored query instead of owning their SQL, so
# editing the query in the store updates the widget too. Only queries whose
# text is identical to the widget's own are linked: if the user deletes the
# asset the FK is set to NULL and the widget falls back to that same SQL, so
# the dashboard cannot be broken from the query store.
LINKED_QUERY_BY_TITLE = {
    "Monthly Order Volume": "Monthly Order Volume",
    "Terminal Workload by Activity": "Terminal Workload by Activity",
}


def _bundled_sample_log_path() -> Path:
    """Absolute path to the event log shipped with the app.

    Frozen: ``sys._MEIPASS`` is the bundle root that the destinations in
    ``totem_backend.spec``'s ``datas`` are relative to. Unfrozen (runserver,
    the test suite, ``npm run electron-dev``): ``backend/`` is this file's
    grandparent. The bundle is read-only and code-signed, so callers copy this
    file into MEDIA_ROOT rather than pointing an EventLog at it.
    """
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)
    else:
        base = Path(__file__).resolve().parent.parent
    return base / "sample_data" / SAMPLE_LOG_FILENAME


# --- The dashboard's two text panels -----------------------------------------
#
# Text boxes store a TipTap/ProseMirror document in `rich_text` (#373). The
# builders below assemble one; every value they emit has to survive
# `validated_rich_text`, which rebuilds a document from a whitelist -- hence
# lowercase hex colours and "NNpx" sizes. `SampleProjectRichTextTests` asserts
# the round trip, so a typo here fails a test rather than being silently
# dropped on the way into the database.
#
# A document owns all text-level formatting: once `rich_text` is set the box's
# font_size/text_color/... fields are ignored entirely (componentMap.tsx renders
# a rich box against the plain defaults), so nothing here sets them. Only
# background_color and vertical_align stay box-level.
#
# Blocks render with no margins, so vertical space comes from empty paragraphs.
#
# No `heading` nodes: the toolbar has no heading control (one needs a markdown
# "## " while typing), so a title here is bold plus a font size -- which keeps
# everything in this dashboard reproducible from the toolbar the user has.

SLATE = "#1e293b"       # body text, from docs/totem_design_system.md
DEEP_BLUE = "#2563eb"   # accent
MUTED = "#64748b"       # metadata


def _run(text, *, bold=False, italic=False, size=None, color=None):
    """One run of text. Mark order matches what the validator emits."""
    marks = []
    if bold:
        marks.append({"type": "bold"})
    if italic:
        marks.append({"type": "italic"})
    attrs = {}
    if color is not None:
        attrs["color"] = color
    if size is not None:
        attrs["fontSize"] = f"{size}px"
    if attrs:
        marks.append({"type": "textStyle", "attrs": attrs})
    node = {"type": "text", "text": text}
    if marks:
        node["marks"] = marks
    return node


def _para(runs=(), align=None):
    """A paragraph, or -- with no runs -- the blank line between two blocks.

    `align` is worth setting on every paragraph that holds text: a rich box
    inherits text-align from its container (only the plain-text path writes it
    explicitly), so an unaligned document silently picks up whatever the card
    does -- which is `center`, and makes a list look broken.
    """
    node = {"type": "paragraph"}
    if align:
        node["attrs"] = {"textAlign": align}
    if runs:
        node["content"] = list(runs)
    return node


def _ordered_list(items, align=None):
    return {
        "type": "orderedList",
        "content": [
            {"type": "listItem", "content": [_para(runs, align)]} for runs in items
        ],
    }


def _rule():
    return {"type": "horizontalRule"}


def sample_headline_doc():
    """The masthead: who this is, what the log covers, how big it is."""
    return {
        "type": "doc",
        "content": [
            _para([_run("Meridian Freight Systems",
                        bold=True, size=30, color=SLATE)], "center"),
            _para([_run("Container Operations Overview", size=17, color=DEEP_BLUE)],
                  "center"),
            _para(),
            _rule(),
            _para(),
            _para([
                _run("From "),
                _run("order intake to departure", bold=True),
                _run(
                    ", this dashboard follows the container lifecycle across our "
                    "terminal network — customer orders, container handling, "
                    "vehicle dispatch and turnaround performance."
                ),
            ], "center"),
            _para(),
            _para([
                _run(
                    "Bundled sample log · 35,372 events · 13,882 objects "
                    "· 7 object types · May 2023 – Aug 2024",
                    size=12,
                    color=MUTED,
                )
            ], "center"),
        ],
    }


def sample_guide_doc():
    """A short reading guide, below the widgets it describes."""
    return {
        "type": "doc",
        "content": [
            _para([_run("How to read this dashboard",
                        bold=True, size=20, color=SLATE)], "left"),
            _para(),
            _ordered_list([
                [
                    _run("Headline KPIs", bold=True),
                    _run(
                        " — order volume, average end-to-end lead time, and "
                        "how often a container had to be rescheduled."
                    ),
                ],
                [
                    _run("Monthly Order Volume", bold=True),
                    _run(
                        " — order intake per month. The short bars at either "
                        "end are partial months, not a collapse in demand."
                    ),
                ],
                [
                    _run("Terminal Workload by Activity", bold=True),
                    _run(
                        " — which of the log's 14 activities absorb the "
                        "effort; the long tail is grouped into one slice."
                    ),
                ],
                [
                    _run("Process Areas", bold=True),
                    _run(
                        " — the seven object types in the log, arranged into "
                        "levels by how they interact."
                    ),
                ],
            ], "left"),
            _para(),
            _rule(),
            _para(),
            {
                "type": "blockquote",
                "content": [
                    _para([
                        _run(
                            "The bar and donut run stored queries — edit one under "
                            "Project Assets → SQL Queries and the chart follows.",
                            italic=True,
                            size=13,
                            color=MUTED,
                        )
                    ], "left")
                ],
            },
        ],
    }


def _text_box(doc, **fields):
    """A text box's fields. `text` is kept in step with the document so the
    column stays meaningful for anything that still reads it."""
    return {"rich_text": doc, "text": plain_text_from_doc(doc), **fields}


def sample_dashboard_layout():
    """The sample dashboard, as (model name, component_name, geometry, fields).

    Geometry is GridStack's own: a 12-column grid with 70px rows. A logo and a
    masthead across the top, then six representations of the log -- three KPIs,
    a bar chart, a donut and the process areas -- and a reading guide under
    them. The two text panels are rich-text documents; see the builders above.

    Returned lazily (not a module constant) so the models are imported inside
    the app registry rather than at import time.
    """
    from .models import (
        BarChartComponent,
        ImageComponent,
        KpiComponent,
        PieChartComponent,
        ProcessAreaComponent,
        TextBoxComponent,
    )

    return [
        (ImageComponent, "ImageComponent", (0, 0, 3, 5), {
            # image_asset is filled in by the seed once the logo exists.
            "image_fit": "contain",
            "image_alignment": "center",
        }),
        (TextBoxComponent, "TextBoxComponent", (3, 0, 9, 5), _text_box(
            sample_headline_doc(), vertical_align="middle",
        )),
        (KpiComponent, "KpiComponent", (0, 5, 4, 3), {
            "title": "Customer Orders Handled",
            "query": QUERY_CUSTOMER_ORDERS,
            "value_column": "value",
            "suffix": " orders",
            "decimals": 0,
        }),
        (KpiComponent, "KpiComponent", (4, 5, 4, 3), {
            "title": "Avg. Order Lead Time",
            "query": QUERY_ORDER_LEAD_TIME,
            "value_column": "value",
            "suffix": " days",
            "decimals": 1,
        }),
        (KpiComponent, "KpiComponent", (8, 5, 4, 3), {
            "title": "Container Reschedule Rate",
            "query": QUERY_RESCHEDULE_RATE,
            "value_column": "value",
            "suffix": "%",
            "decimals": 1,
        }),
        (BarChartComponent, "BarChartComponent", (0, 8, 7, 6), {
            "title": "Monthly Order Volume",
            "query": QUERY_MONTHLY_ORDERS,
            "label_column": "label",
            "value_column": "value",
            "show_values": True,
        }),
        (PieChartComponent, "PieChartComponent", (7, 8, 5, 6), {
            "title": "Terminal Workload by Activity",
            "query": QUERY_ACTIVITY_WORKLOAD,
            "label_column": "label",
            "value_column": "value",
            "chart_type": "donut",
            "ring_text": "Events",
        }),
        # No query and no title field: the process areas are discovered from the
        # log, and the card's heading is frontend chrome.
        (ProcessAreaComponent, "ProcessAreaComponent", (0, 14, 12, 7), {}),
        # Below everything it describes, so the widgets lead and the guide
        # follows. Appended at y=21, where the process areas end.
        (TextBoxComponent, "TextBoxComponent", (0, 21, 12, 4), _text_box(
            sample_guide_doc(),
        )),
    ]


def _sample_user():
    """The account the sample project belongs to.

    ``api`` precedes ``authentification`` in INSTALLED_APPS, so this hook can
    run before ensure_guest_user has provisioned the Guest account. Fetching it
    defensively keeps the two seeds independent of signal ordering: password and
    activation belong to ensure_guest_user, and whichever runs second converges
    the row.
    """
    User = get_user_model()
    user, _ = User.objects.get_or_create(
        username=settings.LOCAL_GUEST_USERNAME,
        defaults={"email": "guest@local.host", "is_active": True},
    )
    return user


def _create_sample_project(user, source_log: Path, written: list):
    """Build the sample project. Every file saved to storage is appended to
    ``written`` as it lands, so the caller can remove it again if the
    transaction rolls back -- a rollback undoes rows, not files."""
    from .models import (
        Dashboard,
        EventLog,
        ImageAsset,
        Project,
        ProjectAsset,
    )

    project = Project.objects.create(
        name=SAMPLE_PROJECT_NAME,
        display_name=SAMPLE_PROJECT_DISPLAY_NAME,
    )
    project.users.add(user)

    # Saving through the FieldFile copies the bundled log into MEDIA_ROOT with
    # the same collision handling a real upload gets. No OCEL conversion is
    # needed -- the source is already .duckdb, which is also what the SQL
    # widgets require.
    event_log = EventLog(project=project)
    with open(source_log, "rb") as handle:
        event_log.file.save(SAMPLE_LOG_FILENAME, File(handle), save=False)
    written.append(event_log.file)
    event_log.save()

    logo = ImageAsset(
        project=project,
        name=SAMPLE_LOGO_ASSET_NAME,
        content_type="image/svg+xml",
        created_by=user,
    )
    logo.image.save(
        SAMPLE_LOGO_FILENAME,
        ContentFile(SAMPLE_LOGO_SVG.encode("utf-8")),
        save=False,
    )
    written.append(logo.image)
    logo.save()

    # The query store. Created before the dashboard so the widgets below can
    # link the ones they share SQL with.
    stored_queries = {}
    for name, description, sql in SAMPLE_QUERIES:
        stored_queries[name] = ProjectAsset.objects.create(
            project=project,
            name=name,
            asset_type=ProjectAsset.AssetType.QUERY,
            content_json={
                "schema": SQL_QUERY_ASSET_SCHEMA,
                "version": SQL_QUERY_ASSET_VERSION,
                "query": sql,
                "description": description,
            },
            created_by=user,
        )

    dashboard = Dashboard.objects.create(
        project=project,
        name=SAMPLE_DASHBOARD_NAME,
        order_in_project=0,
    )

    for order, (model, component_name, (x, y, w, h), fields) in enumerate(
        sample_dashboard_layout()
    ):
        extra = dict(fields)
        if component_name == "ImageComponent":
            extra["image_asset"] = logo
        linked = LINKED_QUERY_BY_TITLE.get(extra.get("title"))
        if linked:
            extra["query_asset"] = stored_queries[linked]
        model.objects.create(
            dashboard=dashboard,
            component_name=component_name,
            x=x, y=y, w=w, h=h,
            order=order,
            **extra,
        )

    return project


def seed_sample_project(sender, **kwargs):
    """post_migrate receiver: provision the sample project exactly once."""
    if not getattr(settings, "SEED_SAMPLE_PROJECT", False):
        return

    from .models import Project, SeedState

    # post_migrate also fires after migrating *backwards*; unapplying the
    # migration that creates SeedState must not make `migrate` itself fail.
    if SeedState._meta.db_table not in connection.introspection.table_names():
        return

    if SeedState.objects.filter(key=SAMPLE_SEED_KEY).exists():
        return

    source_log = _bundled_sample_log_path()
    if not source_log.is_file():
        # A packaging mistake, not a user error. Leaving the tombstone unwritten
        # means a later build that ships the file correctly still seeds.
        logger.error(
            "Sample event log not found at %s; skipping sample project seed",
            source_log,
        )
        return

    written = []
    try:
        with transaction.atomic():
            # Re-check inside the transaction: two processes can run migrate at
            # once, and the unique key is what actually settles the race.
            if SeedState.objects.filter(key=SAMPLE_SEED_KEY).exists():
                return
            # The sample is for a fresh install. An install upgraded from a
            # version without it already has the user's own projects, so it is
            # marked as seeded instead of having a demo project dropped into it.
            if Project.objects.exists():
                SeedState.objects.create(key=SAMPLE_SEED_KEY)
                logger.info("Existing projects found; not seeding the sample project")
                return
            project = _create_sample_project(_sample_user(), source_log, written)
            SeedState.objects.create(key=SAMPLE_SEED_KEY)
    except Exception:
        # Rolling back takes the tombstone with it, so the next launch retries
        # rather than leaving a half-built project behind forever. The files
        # already copied into MEDIA_ROOT are not part of the transaction, and a
        # retry would save fresh copies under new names, so remove them here.
        for field_file in written:
            try:
                field_file.storage.delete(field_file.name)
            except Exception:
                logger.exception("Could not remove %s after a failed seed", field_file.name)
        logger.exception("Could not seed the sample project")
        return

    logger.info("Seeded sample project %r (id=%s)", project.display_name, project.pk)
