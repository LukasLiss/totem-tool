"""
Comprehensive Unit and Integration Test Suite for MCP Server, Policy Engine,
and DashboardService Polymorphic Layer (Milestone 4 / Sub-task #119).
"""

import os
import tempfile
from contextlib import nullcontext
from unittest.mock import MagicMock, patch

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from api.models import (
    Dashboard,
    DashboardComponent,
    EventLog,
    ImageComponent,
    LogStatisticsComponent,
    NewOCDFGComponent,
    NumberofEventsComponent,
    OCCNComponent,
    OCDFGComponent,
    OCDottedChartComponent,
    ProcessAreaComponent,
    Project,
    ProjectAsset,
    TextBoxComponent,
    VariantsComponent,
)
from api.services.dashboard import DashboardService
from mcp_server.policy import (
    DangerLevel,
    TOOL_CATEGORIES,
    TOOL_POLICIES,
    ToolCategory,
    get_category,
    get_danger_level,
    is_mutable,
    requires_confirmation,
)
from mcp_server.server import (
    _clamp_float,
    _resolve_event_log,
    call_tool,
    get_tool_specs,
)
from totem_lib.totem import Totem, totem_to_dict
from totem_lib.variants.ocvariants import Variant


class McpSchemaAndPolicyTests(TestCase):
    """Verify tool specification schemas and security policy classifications."""

    def test_total_tool_count_is_18(self):
        specs = get_tool_specs()
        self.assertEqual(len(specs), 18)
        self.assertEqual(len(TOOL_CATEGORIES), 18)
        self.assertEqual(len(TOOL_POLICIES), 18)

    def test_all_specs_have_valid_structure(self):
        for spec in get_tool_specs():
            self.assertIn("name", spec)
            self.assertIn("description", spec)
            self.assertIn("parameters", spec)
            params = spec["parameters"]
            self.assertEqual(params.get("type"), "object")
            self.assertIn("properties", params)
            self.assertIn("required", params)

    def test_policy_classification_categories(self):
        read_only_tools = [
            "get_statistics",
            "get_object_types",
            "discover_totem",
            "discover_occn",
            "discover_mlpa",
            "find_variants",
            "get_oc_dotted_chart",
            "get_layout",
            "list_dashboards",
            "list_assets",
        ]
        mutating_tools = [
            "create_dashboard",
            "add_component",
            "remove_component",
            "update_component",
            "rename_dashboard",
        ]
        frontend_tools = [
            "navigate",
            "set_view_mode",
            "highlight_element",
        ]

        for t in read_only_tools:
            self.assertEqual(get_category(t), ToolCategory.READ_ONLY)
            self.assertEqual(get_danger_level(t), DangerLevel.LOW)
            self.assertFalse(requires_confirmation(t))
            self.assertFalse(is_mutable(t))

        for t in mutating_tools:
            self.assertEqual(get_category(t), ToolCategory.MUTATING)
            self.assertTrue(requires_confirmation(t))
            self.assertTrue(is_mutable(t))

        self.assertEqual(get_danger_level("remove_component"), DangerLevel.HIGH)
        self.assertEqual(get_danger_level("create_dashboard"), DangerLevel.MEDIUM)

        for t in frontend_tools:
            self.assertEqual(get_category(t), ToolCategory.REQUIRES_FRONTEND)
            self.assertEqual(get_danger_level(t), DangerLevel.LOW)
            self.assertFalse(requires_confirmation(t))
            self.assertTrue(is_mutable(t))

    def test_unknown_tool_raises_error(self):
        for invalid in ["unknown_tool", 123, None, "", {}]:
            with self.assertRaises(ValueError):
                get_category(invalid)
            with self.assertRaises(ValueError):
                get_danger_level(invalid)
            with self.assertRaises(ValueError):
                requires_confirmation(invalid)

    def test_clamp_float_helper(self):
        self.assertEqual(_clamp_float(0.5, 0.0, 1.0), 0.5)
        self.assertEqual(_clamp_float(-0.2, 0.0, 1.0), 0.0)
        self.assertEqual(_clamp_float(1.5, 0.0, 1.0), 1.0)
        self.assertEqual(_clamp_float("0.75", 0.0, 1.0), 0.75)
        self.assertEqual(_clamp_float("invalid", 0.0, 1.0, default=0.2), 0.2)
        self.assertEqual(_clamp_float(None, 0.0, 1.0, default=0.5), 0.5)


class DashboardServiceCrudTests(TestCase):
    """Verify DashboardService polymorphic CRUD and multi-tenant security operations."""

    def setUp(self):
        self.user_a = User.objects.create_user(username="user_a", password="password_a")
        self.user_b = User.objects.create_user(username="user_b", password="password_b")

        self.project_a = Project.objects.create(name="Project A")
        self.project_a.users.add(self.user_a)

        self.project_b = Project.objects.create(name="Project B")
        self.project_b.users.add(self.user_b)

    def test_create_dashboard_basic(self):
        dashboard_data = DashboardService.create_dashboard(
            user=self.user_a,
            title="My Executive Dashboard",
            project_id=self.project_a.id,
        )
        self.assertIn("id", dashboard_data)
        self.assertEqual(dashboard_data["name"], "My Executive Dashboard")
        self.assertEqual(dashboard_data["project_id"], self.project_a.id)
        self.assertEqual(dashboard_data["order_in_project"], 0)

        # Create second dashboard in same project, verify ordering
        dashboard_2 = DashboardService.create_dashboard(
            user=self.user_a,
            title="Operations Dashboard",
            project_id=self.project_a.id,
        )
        self.assertEqual(dashboard_2["order_in_project"], 1)

    def test_create_dashboard_with_layout(self):
        layout = [
            {
                "component_name": "TextBoxComponent",
                "x": 0,
                "y": 0,
                "w": 6,
                "h": 2,
                "props": {"text": "Welcome to TOTeM", "font_size": 18},
            },
            {
                "component_name": "LogStatisticsComponent",
                "x": 6,
                "y": 0,
                "w": 6,
                "h": 4,
                "props": {"show_num_events": True, "show_duration": True},
            },
        ]
        dashboard_data = DashboardService.create_dashboard(
            user=self.user_a,
            title="Dashboard With Initial Layout",
            project_id=self.project_a.id,
            layout=layout,
        )
        self.assertEqual(len(dashboard_data["components"]), 2)
        text_comp = next(c for c in dashboard_data["components"] if c["resourcetype"] == "TextBoxComponent")
        self.assertEqual(text_comp["text"], "Welcome to TOTeM")
        self.assertEqual(text_comp["font_size"], 18)

    def test_get_dashboard_with_components(self):
        dash = DashboardService.create_dashboard(user=self.user_a, title="Detail Dashboard")
        DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash["id"],
            component_type="TextBoxComponent",
            config={"text": "Hello World", "font_size": 16},
        )
        retrieved = DashboardService.get_dashboard(user=self.user_a, dashboard_id=dash["id"])
        self.assertEqual(retrieved["id"], dash["id"])
        self.assertEqual(len(retrieved["components"]), 1)
        self.assertEqual(retrieved["components"][0]["text"], "Hello World")

    def test_list_dashboards(self):
        DashboardService.create_dashboard(user=self.user_a, title="Dashboard 1", project_id=self.project_a.id)
        DashboardService.create_dashboard(user=self.user_a, title="Dashboard 2", project_id=self.project_a.id)

        dashboards_a = DashboardService.list_dashboards(user=self.user_a, project_id=self.project_a.id)
        self.assertEqual(len(dashboards_a), 2)

        dashboards_b = DashboardService.list_dashboards(user=self.user_b, project_id=self.project_b.id)
        self.assertEqual(len(dashboards_b), 0)

    def test_rename_dashboard(self):
        dash = DashboardService.create_dashboard(user=self.user_a, title="Old Title")
        renamed = DashboardService.rename_dashboard(user=self.user_a, dashboard_id=dash["id"], title="New Title")
        self.assertEqual(renamed["name"], "New Title")

        with self.assertRaises(ValueError):
            DashboardService.rename_dashboard(user=self.user_a, dashboard_id=dash["id"], title="")

    def test_delete_dashboard(self):
        dash = DashboardService.create_dashboard(user=self.user_a, title="To Delete")
        DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash["id"],
            component_type="TextBoxComponent",
            config={"text": "Card"},
        )
        self.assertEqual(DashboardComponent.objects.filter(dashboard_id=dash["id"]).count(), 1)

        result = DashboardService.delete_dashboard(user=self.user_a, dashboard_id=dash["id"])
        self.assertEqual(result["status"], "deleted")
        self.assertFalse(Dashboard.objects.filter(id=dash["id"]).exists())
        self.assertEqual(DashboardComponent.objects.filter(dashboard_id=dash["id"]).count(), 0)

    def test_add_all_10_polymorphic_components(self):
        dash = DashboardService.create_dashboard(user=self.user_a, title="Polymorphic Showcase")
        dash_id = dash["id"]

        # 1. TextBoxComponent
        c1 = DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash_id,
            component_type="TextBoxComponent",
            config={"text": "Test Note", "font_size": 20},
        )
        self.assertEqual(c1["resourcetype"], "TextBoxComponent")
        self.assertEqual(c1["text"], "Test Note")

        # 2. NumberofEventsComponent
        c2 = DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash_id,
            component_type="NumberofEventsComponent",
            config={"color": "emerald"},
        )
        self.assertEqual(c2["resourcetype"], "NumberofEventsComponent")
        self.assertEqual(c2["color"], "emerald")

        # 3. ImageComponent
        c3 = DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash_id,
            component_type="ImageComponent",
            config={"image": "/files/charts/overview.png"},
        )
        self.assertEqual(c3["resourcetype"], "ImageComponent")

        # 4. VariantsComponent
        c4 = DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash_id,
            component_type="VariantsComponent",
            config={
                "automatic_loading": True,
                "leading_object_type": "order",
                "extraction": "leading_bfs",
                "iso": "trace",
                "timeout_s": 5.0,
            },
        )
        self.assertEqual(c4["resourcetype"], "VariantsComponent")
        self.assertEqual(c4["extraction"], "leading_bfs")
        self.assertEqual(c4["iso"], "trace")

        # 5. ProcessAreaComponent
        c5 = DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash_id,
            component_type="ProcessAreaComponent",
        )
        self.assertEqual(c5["resourcetype"], "ProcessAreaComponent")

        # 6. LogStatisticsComponent
        c6 = DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash_id,
            component_type="LogStatisticsComponent",
            config={"show_num_events": True, "show_duration": True},
        )
        self.assertEqual(c6["resourcetype"], "LogStatisticsComponent")
        self.assertTrue(c6["show_duration"])

        # 7. OCDFGComponent
        c7 = DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash_id,
            component_type="OCDFGComponent",
            config={"show_controls": False, "initial_interaction_locked": False},
        )
        self.assertEqual(c7["resourcetype"], "OCDFGComponent")
        self.assertFalse(c7["show_controls"])

        # 8. OCDottedChartComponent
        c8 = DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash_id,
            component_type="OCDottedChartComponent",
            config={"file_id": 42, "x_axis": "time", "y_axis": "activity", "max_points": 5000},
        )
        self.assertEqual(c8["resourcetype"], "OCDottedChartComponent")
        self.assertEqual(c8["file_id"], 42)
        self.assertEqual(c8["max_points"], 5000)

        # 9. NewOCDFGComponent
        c9 = DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash_id,
            component_type="NewOCDFGComponent",
            config={"layout_direction": "LR"},
        )
        self.assertEqual(c9["resourcetype"], "NewOCDFGComponent")
        self.assertEqual(c9["layout_direction"], "LR")

        # 10. OCCNComponent
        c10 = DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash_id,
            component_type="OCCNComponent",
            config={"relative_occurrence_threshold": 0.25, "layout_direction": "TB", "object_types": "order,item"},
        )
        self.assertEqual(c10["resourcetype"], "OCCNComponent")
        self.assertEqual(c10["relative_occurrence_threshold"], 0.25)
        self.assertEqual(c10["layout_direction"], "TB")

        # Verify all 10 saved
        final_dash = DashboardService.get_dashboard(user=self.user_a, dashboard_id=dash_id)
        self.assertEqual(len(final_dash["components"]), 10)

    def test_update_component_geometry_and_props(self):
        dash = DashboardService.create_dashboard(user=self.user_a, title="Update Test")
        comp = DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash["id"],
            component_type="TextBoxComponent",
            config={"text": "Original Text", "font_size": 12},
            position={"x": 0, "y": 0, "w": 4, "h": 2},
        )

        updated = DashboardService.update_component(
            user=self.user_a,
            dashboard_id=dash["id"],
            component_id=comp["id"],
            config={"text": "Updated Text", "font_size": 18},
            position={"x": 2, "y": 1, "w": 8, "h": 4},
        )
        self.assertEqual(updated["text"], "Updated Text")
        self.assertEqual(updated["font_size"], 18)
        self.assertEqual(updated["x"], 2)
        self.assertEqual(updated["y"], 1)
        self.assertEqual(updated["w"], 8)
        self.assertEqual(updated["h"], 4)

    def test_remove_component(self):
        dash = DashboardService.create_dashboard(user=self.user_a, title="Remove Test")
        comp = DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash["id"],
            component_type="TextBoxComponent",
            config={"text": "Card to remove"},
        )
        comp_id = comp["id"]
        res = DashboardService.remove_component(user=self.user_a, dashboard_id=dash["id"], component_id=comp_id)
        self.assertEqual(res["status"], "deleted")
        self.assertFalse(DashboardComponent.objects.filter(id=comp_id).exists())

    def test_multi_tenant_isolation(self):
        dash_a = DashboardService.create_dashboard(user=self.user_a, title="Private A", project_id=self.project_a.id)
        comp_a = DashboardService.add_component(
            user=self.user_a,
            dashboard_id=dash_a["id"],
            component_type="TextBoxComponent",
            config={"text": "Secret A"},
        )

        # User B cannot access User A's dashboard
        with self.assertRaises(PermissionError):
            DashboardService.get_dashboard(user=self.user_b, dashboard_id=dash_a["id"])

        with self.assertRaises(PermissionError):
            DashboardService.rename_dashboard(user=self.user_b, dashboard_id=dash_a["id"], title="Hacked")

        with self.assertRaises(PermissionError):
            DashboardService.add_component(
                user=self.user_b,
                dashboard_id=dash_a["id"],
                component_type="TextBoxComponent",
            )

        with self.assertRaises(PermissionError):
            DashboardService.update_component(
                user=self.user_b,
                dashboard_id=dash_a["id"],
                component_id=comp_a["id"],
                config={"text": "Tampered"},
            )

        with self.assertRaises(PermissionError):
            DashboardService.remove_component(
                user=self.user_b,
                dashboard_id=dash_a["id"],
                component_id=comp_a["id"],
            )

        with self.assertRaises(PermissionError):
            DashboardService.delete_dashboard(user=self.user_b, dashboard_id=dash_a["id"])

    def test_unauthenticated_user_access_rejected(self):
        with self.assertRaises(PermissionError):
            DashboardService.create_dashboard(user=None, title="Unauthorized")

        with self.assertRaises(PermissionError):
            DashboardService.list_dashboards(user=None)


class McpServerToolExecutionTests(TestCase):
    """Verify tool execution dispatcher in backend/mcp_server/server.py."""

    def setUp(self):
        self.user = User.objects.create_user(username="mcp_user", password="password")
        self.project = Project.objects.create(name="MCP Project")
        self.project.users.add(self.user)

        self.event_log = EventLog.objects.create(
            project=self.project,
            file=SimpleUploadedFile("test_log.json", b"{}"),
        )

    def test_frontend_tools_payload(self):
        # 1. navigate
        r1 = call_tool("navigate", {"route": "/dashboard/analysis"})
        self.assertEqual(r1["status"], "dispatched_to_frontend")
        self.assertEqual(r1["action"], "navigate")
        self.assertEqual(r1["arguments"]["route"], "/dashboard/analysis")

        # 2. set_view_mode
        r2 = call_tool("set_view_mode", {"mode": "ocdfg"})
        self.assertEqual(r2["status"], "dispatched_to_frontend")
        self.assertEqual(r2["arguments"]["mode"], "ocdfg")

        # 3. highlight_element
        r3 = call_tool("highlight_element", {"tour_id": "nav-tour-btn", "label": "Click to start"})
        self.assertEqual(r3["status"], "dispatched_to_frontend")
        self.assertEqual(r3["arguments"]["tour_id"], "nav-tour-btn")

    def test_mutating_tools_blocked_without_confirmation(self):
        for tool_name in ["create_dashboard", "add_component", "remove_component", "update_component", "rename_dashboard"]:
            with self.assertRaises(PermissionError):
                call_tool(tool_name, {}, user=self.user, context={})

    def test_mutating_tools_confirmed_execution(self):
        ctx = {"__confirmed__": True}

        # 1. create_dashboard
        dash = call_tool(
            "create_dashboard",
            {"name": "Agent Created Dashboard", "project_id": self.project.id},
            user=self.user,
            context=ctx,
        )
        self.assertIn("id", dash)
        self.assertEqual(dash["name"], "Agent Created Dashboard")
        dash_id = dash["id"]

        # 2. add_component
        comp = call_tool(
            "add_component",
            {
                "dashboard_id": dash_id,
                "component_name": "TextBoxComponent",
                "x": 0,
                "y": 0,
                "w": 6,
                "h": 3,
                "props": {"text": "Agent Note", "font_size": 15},
            },
            user=self.user,
            context=ctx,
        )
        self.assertIn("id", comp)
        self.assertEqual(comp["text"], "Agent Note")
        comp_id = comp["id"]

        # 3. update_component
        upd = call_tool(
            "update_component",
            {
                "dashboard_id": dash_id,
                "component_id": comp_id,
                "props": {"text": "Updated Agent Note"},
                "geometry": {"x": 1, "y": 1, "w": 8, "h": 4},
            },
            user=self.user,
            context=ctx,
        )
        self.assertEqual(upd["text"], "Updated Agent Note")
        self.assertEqual(upd["x"], 1)

        # 4. rename_dashboard
        renamed = call_tool(
            "rename_dashboard",
            {"dashboard_id": dash_id, "name": "Renamed Dashboard"},
            user=self.user,
            context=ctx,
        )
        self.assertEqual(renamed["name"], "Renamed Dashboard")

        # 5. remove_component
        removed = call_tool(
            "remove_component",
            {"dashboard_id": dash_id, "component_id": comp_id},
            user=self.user,
            context=ctx,
        )
        self.assertEqual(removed["status"], "deleted")

    def test_get_statistics_read_only(self):
        mock_db = MagicMock()
        mock_db.conn.execute.return_value.fetchone.side_effect = [
            (150,),            # num_events
            (8,),              # num_unique_activities
            (45,),             # num_objects
            (3,),              # num_object_types
            (1600000000, 1600003600), # ts_row
        ]
        with patch("mcp_server.server._with_ocel_db", return_value=nullcontext(mock_db)):
            res = call_tool("get_statistics", {"file_id": self.event_log.id}, user=self.user)

        self.assertEqual(res["num_events"], 150)
        self.assertEqual(res["num_unique_activities"], 8)
        self.assertEqual(res["num_objects"], 45)
        self.assertEqual(res["num_object_types"], 3)
        self.assertEqual(res["earliest_timestamp"], 1600000000)
        self.assertEqual(res["newest_timestamp"], 1600003600)
        self.assertEqual(res["duration_seconds"], 3600)

    def test_get_object_types_read_only(self):
        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server._object_types", return_value=["delivery", "item", "order"]),
        ):
            res = call_tool("get_object_types", {"file_id": self.event_log.id}, user=self.user)

        self.assertEqual(res["object_types"], ["delivery", "item", "order"])

    def test_discover_totem_read_only(self):
        totem = Totem(
            tempgraph={"nodes": {"Order"}, "D": set(), "Di": set(), "I": set(), "Ii": set(), "P": set()},
            cardinalities={},
            type_relations=set(),
            all_event_types={"Create"},
            object_type_to_event_types={"Order": {"Create"}},
        )
        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server.totemDiscovery_db", return_value=totem),
        ):
            res = call_tool("discover_totem", {"file_id": self.event_log.id}, user=self.user)

        self.assertEqual(res, totem_to_dict(totem))

    def test_discover_occn_read_only(self):
        mock_occn = MagicMock()
        mock_occn.apply_relative_occurrence_threshold.return_value = mock_occn
        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server.discover_occn", return_value=mock_occn),
            patch("mcp_server.server.serialize_occn", return_value={"places": [], "transitions": []}),
        ):
            res = call_tool("discover_occn", {"file_id": self.event_log.id, "threshold": 0.2}, user=self.user)

        self.assertEqual(res, {"places": [], "transitions": []})

    def test_discover_mlpa_read_only(self):
        totem = Totem(
            tempgraph={"nodes": set(), "D": set(), "Di": set(), "I": set(), "Ii": set(), "P": set()},
            cardinalities={},
            type_relations=set(),
            all_event_types=set(),
            object_type_to_event_types={},
        )
        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server.totemDiscovery_db", return_value=totem),
            patch("mcp_server.server.mlpaDiscovery", return_value={0.0: []}),
            patch("mcp_server.server._serialize_mlpa", return_value={"layers": []}),
        ):
            res = call_tool("discover_mlpa", {"file_id": self.event_log.id}, user=self.user)

        self.assertEqual(res, {"layers": []})

    def test_find_variants_read_only(self):
        import networkx as nx

        g = nx.DiGraph()
        g.add_node("e1", label="Create Order", timestamp=100, types=["order"])
        mock_variant = Variant(
            vid="1",
            support=10,
            executions=[],
            graph=g,
        )
        mock_layout = {
            "nodes": [{"id": "e1", "activity": "Create Order", "x": 10, "y_lane": 0, "y_lanes": [0], "types": ["order"]}],
            "edges": [],
            "objects": [],
        }

        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server._object_types", return_value=["order"]),
            patch("mcp_server.server.find_variants", return_value=[mock_variant]),
            patch("mcp_server.server._layout_shim", return_value=MagicMock()),
            patch("mcp_server.server.calculate_layout", return_value=mock_layout),
        ):
            res = call_tool("find_variants", {"file_id": self.event_log.id}, user=self.user)

        self.assertIn("variants", res)
        self.assertEqual(len(res["variants"]), 1)
        self.assertEqual(res["variants"][0]["support"], 10)
        self.assertEqual(res["variants"][0]["signature"], "Create Order")

    def test_find_variants_timeout_error(self):
        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server._object_types", return_value=["order"]),
            patch("mcp_server.server.find_variants", side_effect=TimeoutError("Watchdog timed out")),
        ):
            res = call_tool("find_variants", {"file_id": self.event_log.id, "timeout_s": 5.0}, user=self.user)

        self.assertEqual(res["code"], "TIMEOUT")
        self.assertEqual(res["timeout_s"], 5.0)
        self.assertIn("hint", res)

    def test_get_oc_dotted_chart_read_only(self):
        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server.get_oc_dotted_chart_data", return_value={"points": [], "metadata": {}}),
        ):
            res = call_tool("get_oc_dotted_chart", {"file_id": self.event_log.id}, user=self.user)

        self.assertEqual(res, {"points": [], "metadata": {}})

    def test_get_layout(self):
        graph_data = {
            "nodes": [{"id": "n1"}, {"id": "n2"}, {"id": "n3"}],
            "edges": [{"from": "n1", "to": "n2"}],
        }
        res_tb = call_tool("get_layout", {"graph_type": "ocdfg", "graph_data": graph_data, "direction": "TB"})
        self.assertEqual(res_tb["direction"], "TB")
        self.assertEqual(len(res_tb["nodes"]), 3)
        self.assertEqual(res_tb["nodes"][0]["width"], 140)

        res_lr = call_tool("get_layout", {"graph_type": "ocdfg", "graph_data": graph_data, "direction": "LR"})
        self.assertEqual(res_lr["direction"], "LR")

    def test_list_dashboards_tool(self):
        DashboardService.create_dashboard(user=self.user, title="D1", project_id=self.project.id)
        res = call_tool("list_dashboards", {"project_id": self.project.id}, user=self.user)
        self.assertEqual(len(res["dashboards"]), 1)

    def test_list_assets_tool(self):
        ProjectAsset.objects.create(
            project=self.project,
            name="Discovered TOTeM",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json={},
        )
        ProjectAsset.objects.create(
            project=self.project,
            name="Discovered OCCN",
            asset_type=ProjectAsset.AssetType.OCCN,
            content_json={},
        )
        res_all = call_tool("list_assets", {"project_id": self.project.id}, user=self.user)
        self.assertEqual(len(res_all["assets"]), 2)

        res_totem = call_tool(
            "list_assets",
            {"project_id": self.project.id, "asset_type": "TOTEM"},
            user=self.user,
        )
        self.assertEqual(len(res_totem["assets"]), 1)
        self.assertEqual(res_totem["assets"][0]["asset_type"], "TOTEM")

    def test_error_handling_missing_and_invalid_file_id(self):
        # 1. Invalid file_id string
        res_inv = call_tool("get_statistics", {"file_id": "not-an-int"}, user=self.user)
        self.assertEqual(res_inv["code"], "INVALID_FILE_ID")

        # 2. File not found
        res_nf = call_tool("get_statistics", {"file_id": 999999}, user=self.user)
        self.assertEqual(res_nf["code"], "FILE_NOT_FOUND")

        # 3. File missing on disk
        missing_log = EventLog.objects.create(project=self.project, file="non_existent_file.json")
        res_missing = call_tool("get_statistics", {"file_id": missing_log.id}, user=self.user)
        self.assertEqual(res_missing["code"], "FILE_MISSING_ON_DISK")

        # 4. Missing file_id when no logs exist in user project
        other_user = User.objects.create_user(username="empty_user")
        res_empty = call_tool("get_statistics", {}, user=other_user)
        self.assertEqual(res_empty["code"], "MISSING_FILE_ID")
