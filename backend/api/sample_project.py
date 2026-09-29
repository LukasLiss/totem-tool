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
from django.db import transaction

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

SAMPLE_HEADLINE = """Meridian Freight Systems
Container Operations Overview

From order intake to departure, this dashboard follows the container lifecycle
across our terminal network: customer orders, container handling, vehicle
dispatch and turnaround performance."""

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


def sample_dashboard_layout():
    """The sample dashboard, as (model name, component_name, geometry, fields).

    Geometry is GridStack's own: a 12-column grid with 70px rows. Two branding
    widgets across the top, then six representations of the log -- three KPIs, a
    bar chart, a donut and the process areas. The header row is 5 rows tall
    rather than the side panel's default 1 because the text card carries a
    320px min-height, and 5 x 70px is the first size that clears it.

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
        (TextBoxComponent, "TextBoxComponent", (3, 0, 9, 5), {
            "text": SAMPLE_HEADLINE,
            "font_size": 16,
        }),
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


def _create_sample_project(user, source_log: Path):
    from .models import Dashboard, EventLog, ImageAsset, Project

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
    logo.save()

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

    from .models import SeedState

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

    try:
        with transaction.atomic():
            # Re-check inside the transaction: two processes can run migrate at
            # once, and the unique key is what actually settles the race.
            if SeedState.objects.filter(key=SAMPLE_SEED_KEY).exists():
                return
            project = _create_sample_project(_sample_user(), source_log)
            SeedState.objects.create(key=SAMPLE_SEED_KEY)
    except Exception:
        # Rolling back takes the tombstone with it, so the next launch retries
        # rather than leaving a half-built project behind forever.
        logger.exception("Could not seed the sample project")
        return

    logger.info("Seeded sample project %r (id=%s)", project.display_name, project.pk)
