"""Tests for the assistant tool catalog, its SQL guard and the dashboard tools."""

import tempfile

import duckdb
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings

from api import views
from api.models import Dashboard, EventLog, Project
from totem_lib.ocel.ocel_duckdb import OcelDuckDB, create_ocel_schema

from .policy import ToolCategory, get_category, requires_confirmation
from .server import TOOLS, TOOLS_BY_NAME, ToolContext, ToolError, ToolKind, call_tool, get_tool_specs
from .sql_guard import SqlRejected, validate_select

_MEDIA_ROOT = tempfile.mkdtemp(prefix="totem-assistant-test-media-")

DAY = 86400


def write_order_log(path: str) -> None:
    """Two orders with items: o1 is fast, o2 waits two days before shipping."""
    conn = duckdb.connect(":memory:")
    create_ocel_schema(conn, [], [])
    conn.executemany(
        "INSERT INTO events VALUES (?, ?, ?)",
        [
            ("e1", "place order", 1_700_000_000),
            ("e2", "pick item", 1_700_000_000 + 600),
            ("e3", "ship order", 1_700_000_000 + 3600),
            ("e4", "place order", 1_700_000_000 + DAY),
            ("e5", "pick item", 1_700_000_000 + DAY + 600),
            ("e6", "ship order", 1_700_000_000 + 3 * DAY),
        ],
    )
    conn.executemany("INSERT INTO objects VALUES (?, ?)", [("o1", "order"), ("o2", "order"), ("i1", "item"), ("i2", "item")])
    conn.executemany(
        "INSERT INTO event_object VALUES (?, ?, NULL)",
        [("e1", "o1"), ("e1", "i1"), ("e2", "i1"), ("e3", "o1"), ("e3", "i1"), ("e4", "o2"), ("e4", "i2"), ("e5", "i2"), ("e6", "o2"), ("e6", "i2")],
    )
    db = OcelDuckDB._from_prepared_connection(conn, [], [])
    db.save(path)
    db.close()


class ToolCatalogTests(TestCase):
    def test_every_tool_schema_is_a_closed_object(self):
        for tool in TOOLS:
            self.assertEqual(tool.parameters["type"], "object", tool.name)
            self.assertFalse(tool.parameters.get("additionalProperties", True), tool.name)
            if tool.kind is not ToolKind.CLIENT:
                self.assertIsNotNone(tool.handler, tool.name)

    def test_teach_mode_offers_no_data_changes(self):
        teach = {s["name"] for s in get_tool_specs("teach")}
        act = {s["name"] for s in get_tool_specs("act")}
        self.assertNotIn("create_dashboard", teach)
        self.assertNotIn("open_view", teach)
        self.assertIn("start_tour", teach)
        self.assertIn("create_dashboard", act)
        self.assertTrue(teach < act)

    def test_tool_order_is_stable(self):
        self.assertEqual(get_tool_specs("act"), get_tool_specs("act"))

    def test_policy_follows_tool_kind(self):
        self.assertEqual(get_category("get_log_overview"), ToolCategory.READ_ONLY)
        self.assertEqual(get_category("delete_dashboard"), ToolCategory.MUTATING)
        self.assertEqual(get_category("start_tour"), ToolCategory.REQUIRES_FRONTEND)
        self.assertTrue(requires_confirmation("create_dashboard"))
        self.assertFalse(requires_confirmation("query_event_log"))
        with self.assertRaises(ValueError):
            get_category("rm_rf")


class SqlGuardTests(TestCase):
    def setUp(self):
        self.conn = duckdb.connect(":memory:")

    def test_accepts_selects_over_log_tables(self):
        for sql in [
            "SELECT activity, COUNT(*) FROM events GROUP BY 1",
            "with a as (select * from events) select * from a join event_object using (event_id);",
            "select o.obj_type from main.objects o",
        ]:
            validate_select(self.conn, sql)

    def test_rejects_everything_else(self):
        for sql in [
            "",
            "COPY events TO '/tmp/out.csv'",
            "ATTACH 'other.db'",
            "SELECT 1; SELECT 2",
            "DROP TABLE events",
            "SELECT * FROM read_csv('/etc/passwd')",
            "SELECT * FROM read_parquet('x.parquet')",
            "SELECT * FROM 'data.parquet'",
            "SELECT * FROM glob('*')",
            "SELECT getenv('HOME')",
            "SELECT * FROM duckdb_settings()",
            "SELECT * FROM other_db.main.events",
            "SELECT * FROM secrets",
            "SELECT * FROM (SELECT * FROM read_json_auto('x.json'))",
            "SELECT * FROM events WHERE activity IN (SELECT content FROM read_text('/etc/hosts'))",
        ]:
            with self.assertRaises(SqlRejected, msg=sql):
                validate_select(self.conn, sql)


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class ReadToolTests(TestCase):
    def setUp(self):
        cache.clear()
        views._OCEL_DB_REGISTRY.clear()
        views._OCEL_OBJECT_TYPES_REGISTRY.clear()
        self.user = User.objects.create_user("analyst", password="pw")
        self.other = User.objects.create_user("other", password="pw")
        self.project = Project.objects.create(name="orders")
        self.project.users.add(self.user)
        filename = f"orders-{self._testMethodName}.duckdb"
        write_order_log(f"{_MEDIA_ROOT}/{filename}")
        self.log = EventLog.objects.create(project=self.project, file=filename)
        self.ctx = ToolContext(user=self.user, active_file_id=self.log.id, project_id=self.project.id)

    def test_overview_summarizes_the_log(self):
        r = call_tool("get_log_overview", {}, self.ctx)
        self.assertEqual(r["events"], 6)
        self.assertEqual(r["objects"], 4)
        self.assertEqual(r["activities"], 3)
        self.assertEqual(r["time_range"]["start"], "2023-11-14T22:13:20Z")
        types = {t["object_type"]: t for t in r["object_types"]}
        self.assertEqual(types["order"]["objects"], 2)
        self.assertIn("events", {s["table"] for s in r["schema"]})

    def test_directly_follows_reports_waiting_times(self):
        r = call_tool("get_directly_follows", {"object_type": "order"}, self.ctx)
        edge = r["edges"][0]
        self.assertEqual((edge["from"], edge["to"], edge["frequency"]), ("place order", "ship order", 2))
        # waits are 1h and 2d -> median 1.02 days
        self.assertAlmostEqual(edge["median_wait_seconds"], (3600 + 2 * DAY) / 2)
        self.assertEqual(r["start_activities"], [{"activity": "place order", "objects": 2}])

    def test_activity_stats_filtered_by_object_type(self):
        r = call_tool("get_activity_stats", {"object_type": "order"}, self.ctx)
        self.assertEqual({a["activity"] for a in r["activities"]}, {"place order", "ship order"})
        with self.assertRaises(ToolError) as cm:
            call_tool("get_activity_stats", {"object_type": "invoice"}, self.ctx)
        self.assertIn("order", cm.exception.hint)

    def test_query_runs_and_caps_rows(self):
        r = call_tool("query_event_log", {"sql": "SELECT event_id FROM events ORDER BY 1", "max_rows": 4}, self.ctx)
        self.assertEqual(r["rows"], [["e1"], ["e2"], ["e3"], ["e4"]])
        self.assertTrue(r["truncated"])
        with self.assertRaises(ToolError) as cm:
            call_tool("query_event_log", {"sql": "SELECT * FROM read_csv('/etc/passwd')"}, self.ctx)
        self.assertEqual(cm.exception.code, "SQL_REJECTED")

    def test_variants_are_summarized(self):
        r = call_tool("find_variants", {"leading_object_type": "order"}, self.ctx)
        self.assertEqual(r["total_cases"], 2)
        self.assertEqual(r["top_variants"][0]["activity_sequence"][0], "place order")
        self.assertNotIn("graph", r["top_variants"][0])

    def test_totem_summary(self):
        r = call_tool("discover_totem", {}, self.ctx)
        self.assertEqual(sorted(r["object_types"]), ["item", "order"])
        self.assertIn("activities_per_object_type", r)

    def test_no_selected_log_asks_model_to_list_logs(self):
        with self.assertRaises(ToolError) as cm:
            call_tool("get_log_overview", {}, ToolContext(user=self.user))
        self.assertEqual(cm.exception.code, "NO_EVENT_LOG")
        logs = call_tool("list_event_logs", {}, ToolContext(user=self.user))["event_logs"]
        self.assertEqual([l["file_id"] for l in logs], [self.log.id])

    def test_other_users_cannot_read_the_log(self):
        with self.assertRaises(ToolError) as cm:
            call_tool("get_log_overview", {"file_id": self.log.id}, ToolContext(user=self.other))
        self.assertEqual(cm.exception.code, "FILE_NOT_FOUND")
        self.assertEqual(call_tool("list_event_logs", {}, ToolContext(user=self.other))["event_logs"], [])

    def test_arguments_are_validated(self):
        with self.assertRaises(ToolError) as cm:
            call_tool("get_log_overview", {"file_id": "abc"}, self.ctx)
        self.assertEqual(cm.exception.code, "INVALID_ARGUMENT")
        with self.assertRaises(ToolError):
            call_tool("get_log_overview", {"unexpected": 1}, self.ctx)
        with self.assertRaises(ToolError) as cm:
            call_tool("nope", {}, self.ctx)
        self.assertEqual(cm.exception.code, "UNKNOWN_TOOL")
        with self.assertRaises(ToolError):
            call_tool("open_view", {"view": "overview"}, self.ctx)  # browser-side tool


class DashboardToolTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("builder", password="pw")
        self.project = Project.objects.create(name="p")
        self.project.users.add(self.user)
        self.ctx = ToolContext(user=self.user, project_id=self.project.id)

    def test_create_add_update_rename_remove_delete(self):
        created = call_tool(
            "create_dashboard",
            {"name": "Ops", "components": [{"component_name": "LogStatisticsComponent", "x": 0, "y": 0, "w": 12, "h": 2}]},
            self.ctx,
        )
        dash_id = created["dashboard_id"]
        self.assertEqual(Dashboard.objects.get(id=dash_id).project_id, self.project.id)
        self.assertEqual(created["components"], 1)

        added = call_tool("add_component", {"dashboard_id": dash_id, "component_name": "TextBoxComponent", "props": {"text": "hi"}}, self.ctx)
        detail = call_tool("get_dashboard", {"dashboard_id": dash_id}, self.ctx)
        self.assertEqual(len(detail["components"]), 2)

        call_tool("update_component", {"component_id": added["component_id"], "w": 4}, self.ctx)
        call_tool("rename_dashboard", {"dashboard_id": dash_id, "name": "Ops 2"}, self.ctx)
        self.assertEqual(Dashboard.objects.get(id=dash_id).name, "Ops 2")
        call_tool("remove_component", {"component_id": added["component_id"]}, self.ctx)
        self.assertEqual(len(call_tool("get_dashboard", {"dashboard_id": dash_id}, self.ctx)["components"]), 1)
        call_tool("delete_dashboard", {"dashboard_id": dash_id}, self.ctx)
        self.assertFalse(Dashboard.objects.filter(id=dash_id).exists())

    def test_unknown_component_type_is_rejected_by_schema(self):
        with self.assertRaises(ToolError):
            call_tool("create_dashboard", {"name": "x", "components": [{"component_name": "Bogus"}]}, self.ctx)

    def test_cannot_touch_someone_elses_dashboard(self):
        dash_id = call_tool("create_dashboard", {"name": "Mine"}, self.ctx)["dashboard_id"]
        intruder = User.objects.create_user("intruder", password="pw")
        with self.assertRaises(ToolError):
            call_tool("delete_dashboard", {"dashboard_id": dash_id}, ToolContext(user=intruder))
        self.assertTrue(Dashboard.objects.filter(id=dash_id).exists())

    def test_catalog_lists_every_component_type_the_service_knows(self):
        from api.services.dashboard import DashboardService

        known = {canonical for _, canonical in DashboardService.COMPONENT_REGISTRY.values()}
        self.assertEqual(set(TOOLS_BY_NAME["add_component"].parameters["properties"]["component_name"]["enum"]), known)


class MarkdownToRichTextTests(TestCase):
    def test_converts_the_markdown_models_write(self):
        from .markdown_doc import markdown_to_doc

        doc = markdown_to_doc(
            "## Container bottlenecks\n\n"
            "- **PlaceinStock → BringtoLoadingBay**: median 7.9 d\n"
            "- Reschedules are *rare*\n\n"
            "1. First\n2. Second\n\n"
            "Watch `LoadTruck` waits.\n---\nEnd"
        )
        types = [b["type"] for b in doc["content"]]
        self.assertEqual(types, ["heading", "bulletList", "orderedList", "paragraph", "horizontalRule", "paragraph"])
        self.assertEqual(doc["content"][0]["attrs"], {"level": 2})
        first_item = doc["content"][1]["content"][0]["content"][0]["content"]
        self.assertEqual(first_item[0], {"type": "text", "text": "PlaceinStock → BringtoLoadingBay", "marks": [{"type": "bold"}]})
        self.assertEqual(doc["content"][1]["content"][1]["content"][0]["content"][1]["marks"], [{"type": "italic"}])
        self.assertEqual(doc["content"][3]["content"][1]["marks"], [{"type": "code"}])

    def test_plain_text_and_snake_case_stay_plain(self):
        from .markdown_doc import markdown_to_doc

        doc = markdown_to_doc("Use leading_object_type and 2*3 stays literal.")
        self.assertEqual(doc["content"][0]["content"], [{"type": "text", "text": "Use leading_object_type and 2*3 stays literal."}])

    def test_text_box_created_by_the_assistant_gets_rich_text(self):
        from api.models import TextBoxComponent

        user = User.objects.create_user("writer", password="pw")
        project = Project.objects.create(name="p")
        project.users.add(user)
        ctx = ToolContext(user=user, project_id=project.id)
        created = call_tool(
            "create_dashboard",
            {"name": "Notes", "components": [{"component_name": "TextBoxComponent", "props": {"text": "## Baseline\n- **7.9 d** in stock"}}]},
            ctx,
        )
        box = TextBoxComponent.objects.get(dashboard_id=created["dashboard_id"])
        self.assertEqual(box.rich_text["content"][0]["type"], "heading")
        self.assertEqual(box.text, "Baseline\n7.9 d in stock")

        call_tool("update_component", {"component_id": box.id, "props": {"text": "Plain **update**"}}, ctx)
        box.refresh_from_db()
        self.assertEqual(box.rich_text["content"][0]["content"][1]["marks"], [{"type": "bold"}])
        self.assertEqual(box.text, "Plain update")


class ApprovalDescriptionTests(TestCase):
    def test_update_cards_say_what_changes(self):
        describe = TOOLS_BY_NAME["update_component"].summary
        self.assertEqual(
            describe({"component_id": 14, "props": {"text": "## Waiting\n- **7.9 d** in stock"}}),
            'Update component 14: set text to "Waiting 7.9 d in stock"',
        )
        self.assertEqual(describe({"component_id": 3, "w": 6, "props": {"leading_object_type": "Container"}}), "Update component 3: change leading_object_type; move/resize")
        self.assertEqual(describe({"component_id": 3}), "Update component 3")
