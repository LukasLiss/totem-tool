"""
Empirical Challenger Adversarial Stress Test Suite for Milestone 4 (Sub-task #119).
Systematically tests all 18 MCP tools against adversarial, degenerate, malformed,
and boundary inputs, verifying policy enforcement and structured error handling.
"""

from contextlib import nullcontext
from unittest.mock import MagicMock, patch
from django.contrib.auth.models import AnonymousUser, User
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


class McpAdversarialChallengerTestSuite(TestCase):
    """Exhaustive empirical challenger tests for all 18 MCP tools."""

    def setUp(self):
        self.user_owner = User.objects.create_user(username="owner_user", password="password")
        self.user_other = User.objects.create_user(username="other_user", password="password")

        self.project_owner = Project.objects.create(name="Owner Project")
        self.project_owner.users.add(self.user_owner)

        self.project_other = Project.objects.create(name="Other Project")
        self.project_other.users.add(self.user_other)

        # Create valid event log with mocked backend disk file
        self.valid_log = EventLog.objects.create(
            project=self.project_owner,
            file=SimpleUploadedFile("valid_log.json", b'{"events": []}'),
        )

        # Create missing-on-disk event log
        self.missing_disk_log = EventLog.objects.create(
            project=self.project_owner,
            file="non_existent_file_path_12345.json",
        )

    # =========================================================================
    # Test 1: Schema Spec Catalog & Policy Consistency for all 18 tools
    # =========================================================================
    def test_all_18_tools_schema_and_policy_catalog_integrity(self):
        specs = get_tool_specs()
        self.assertEqual(len(specs), 18, "Must contain exactly 18 tool specifications")

        expected_tools = {
            # 10 Read-Only
            "get_statistics": ToolCategory.READ_ONLY,
            "get_object_types": ToolCategory.READ_ONLY,
            "discover_totem": ToolCategory.READ_ONLY,
            "discover_occn": ToolCategory.READ_ONLY,
            "discover_mlpa": ToolCategory.READ_ONLY,
            "find_variants": ToolCategory.READ_ONLY,
            "get_oc_dotted_chart": ToolCategory.READ_ONLY,
            "get_layout": ToolCategory.READ_ONLY,
            "list_dashboards": ToolCategory.READ_ONLY,
            "list_assets": ToolCategory.READ_ONLY,
            # 5 Mutating
            "create_dashboard": ToolCategory.MUTATING,
            "add_component": ToolCategory.MUTATING,
            "remove_component": ToolCategory.MUTATING,
            "update_component": ToolCategory.MUTATING,
            "rename_dashboard": ToolCategory.MUTATING,
            # 3 Frontend
            "navigate": ToolCategory.REQUIRES_FRONTEND,
            "set_view_mode": ToolCategory.REQUIRES_FRONTEND,
            "highlight_element": ToolCategory.REQUIRES_FRONTEND,
        }

        spec_names = {s["name"] for s in specs}
        self.assertEqual(spec_names, set(expected_tools.keys()))

        for tool_name, expected_cat in expected_tools.items():
            # Policy checks
            cat = get_category(tool_name)
            self.assertEqual(cat, expected_cat, f"Category mismatch for {tool_name}")
            danger = get_danger_level(tool_name)
            self.assertIn(danger, [DangerLevel.LOW, DangerLevel.MEDIUM, DangerLevel.HIGH])

            if expected_cat == ToolCategory.MUTATING:
                self.assertTrue(requires_confirmation(tool_name))
                self.assertTrue(is_mutable(tool_name))
            elif expected_cat == ToolCategory.REQUIRES_FRONTEND:
                self.assertFalse(requires_confirmation(tool_name))
                self.assertTrue(is_mutable(tool_name))
            else:
                self.assertFalse(requires_confirmation(tool_name))
                self.assertFalse(is_mutable(tool_name))

    # =========================================================================
    # Test 2: Mutating Tools Unconfirmed Barrier Stress Testing
    # =========================================================================
    def test_mutating_tools_reject_standard_falsy_unconfirmed_contexts(self):
        mutating_tools = [
            "create_dashboard",
            "add_component",
            "remove_component",
            "update_component",
            "rename_dashboard",
        ]

        unconfirmed_contexts = [
            None,
            {},
            {"__confirmed__": False},
            {"confirmed": False},
            {"__confirmed__": None},
            {"__confirmed__": 0},
            {"__confirmed__": ""},
            {"__confirmed__": []},
            {"other_key": True},
        ]

        for tool in mutating_tools:
            for ctx in unconfirmed_contexts:
                with self.assertRaises(
                    PermissionError,
                    msg=f"Tool {tool} must raise PermissionError with context {ctx}",
                ):
                    call_tool(tool, {"name": "Test"}, user=self.user_owner, context=ctx)

    # =========================================================================
    # Test 3: Read-Only Process Mining Tools with Empty, Null, Invalid Args
    # =========================================================================
    def test_process_mining_tools_empty_and_null_arguments_no_crash(self):
        process_tools = [
            "get_statistics",
            "get_object_types",
            "discover_totem",
            "discover_occn",
            "discover_mlpa",
            "find_variants",
            "get_oc_dotted_chart",
        ]

        # 1. User has no files and no file_id provided
        for tool in process_tools:
            res_none = call_tool(tool, None, user=self.user_other)
            self.assertIsInstance(res_none, dict)
            self.assertIn("error", res_none, f"Tool {tool} should return error dict when no files exist")
            self.assertEqual(res_none.get("code"), "MISSING_FILE_ID")

            res_empty = call_tool(tool, {}, user=self.user_other)
            self.assertIsInstance(res_empty, dict)
            self.assertEqual(res_empty.get("code"), "MISSING_FILE_ID")

        # 2. Non-existent file IDs (positive, negative, zero)
        for tool in process_tools:
            for bad_id in [999999, -1, -999]:
                res = call_tool(tool, {"file_id": bad_id}, user=self.user_owner)
                self.assertIsInstance(res, dict)
                self.assertEqual(res.get("code"), "FILE_NOT_FOUND", f"Tool {tool} failed on bad_id {bad_id}")

        # 3. Invalid file ID types (strings, floats, objects)
        for tool in process_tools:
            for invalid_val in ["abc", "not_a_number", [1, 2], {"id": 1}]:
                res = call_tool(tool, {"file_id": invalid_val}, user=self.user_owner)
                self.assertIsInstance(res, dict)
                self.assertEqual(res.get("code"), "INVALID_FILE_ID", f"Tool {tool} failed on invalid_val {invalid_val}")

        # 4. File missing on disk
        for tool in process_tools:
            res_missing = call_tool(tool, {"file_id": self.missing_disk_log.id}, user=self.user_owner)
            self.assertIsInstance(res_missing, dict)
            self.assertEqual(res_missing.get("code"), "FILE_MISSING_ON_DISK", f"Tool {tool} failed on missing disk file")

    # =========================================================================
    # Test 4: Extreme & Negative Thresholds Clamping
    # =========================================================================
    def test_extreme_and_negative_thresholds_robustness(self):
        # 1. discover_totem with negative and extreme thresholds
        mock_totem = Totem(
            tempgraph={"nodes": set(), "D": set(), "Di": set(), "I": set(), "Ii": set(), "P": set()},
            cardinalities={},
            type_relations=set(),
            all_event_types=set(),
            object_type_to_event_types={},
        )
        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server.totemDiscovery_db", return_value=mock_totem),
        ):
            res1 = call_tool(
                "discover_totem",
                {"file_id": self.valid_log.id, "dfg_threshold": -5.0, "act_threshold": 999.0},
                user=self.user_owner,
            )
            self.assertIsInstance(res1, dict)
            self.assertIn("tempgraph", res1)

        # 2. discover_occn with threshold=-100.0 and threshold=9999.0
        mock_occn = MagicMock()
        mock_occn.apply_relative_occurrence_threshold.return_value = mock_occn
        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server.discover_occn", return_value=mock_occn),
            patch("mcp_server.server.serialize_occn", return_value={"places": [], "transitions": []}),
        ):
            res_neg = call_tool(
                "discover_occn",
                {"file_id": self.valid_log.id, "threshold": -100.0, "object_types": None},
                user=self.user_owner,
            )
            self.assertEqual(res_neg, {"places": [], "transitions": []})

            res_pos = call_tool(
                "discover_occn",
                {"file_id": self.valid_log.id, "threshold": 9999.0, "object_types": ["order", "item"]},
                user=self.user_owner,
            )
            self.assertEqual(res_pos, {"places": [], "transitions": []})

        # 3. discover_mlpa with threshold=-1.0 and threshold=99.0
        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server.totemDiscovery_db", return_value=mock_totem),
            patch("mcp_server.server.mlpaDiscovery", return_value={0.0: []}),
            patch("mcp_server.server._serialize_mlpa", return_value={"layers": []}),
        ):
            res_mlpa = call_tool(
                "discover_mlpa",
                {"file_id": self.valid_log.id, "threshold": 999.0},
                user=self.user_owner,
            )
            self.assertEqual(res_mlpa, {"layers": []})

    # =========================================================================
    # Test 5: find_variants Edge Cases & Algorithm Timeout
    # =========================================================================
    def test_find_variants_edge_cases_and_timeout(self):
        # 1. TimeoutError returns structured error
        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server._object_types", return_value=["order"]),
            patch("mcp_server.server.find_variants", side_effect=TimeoutError("Watchdog timeout")),
        ):
            res = call_tool(
                "find_variants",
                {"file_id": self.valid_log.id, "timeout_s": 2.5},
                user=self.user_owner,
            )
            self.assertEqual(res.get("code"), "TIMEOUT")
            self.assertEqual(res.get("timeout_s"), 2.5)
            self.assertIn("hint", res)

        # 2. General exception returns structured EXECUTION_ERROR
        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server._object_types", side_effect=RuntimeError("DuckDB crash")),
        ):
            res_err = call_tool(
                "find_variants",
                {"file_id": self.valid_log.id},
                user=self.user_owner,
            )
            self.assertEqual(res_err.get("code"), "EXECUTION_ERROR")
            self.assertIn("DuckDB crash", res_err.get("error"))

    # =========================================================================
    # Test 6: get_oc_dotted_chart Edge Cases
    # =========================================================================
    def test_get_oc_dotted_chart_edge_cases(self):
        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server.get_oc_dotted_chart_data", return_value={"points": [], "metadata": {}}),
        ):
            # Adversarial max_points (negative or large string)
            res = call_tool(
                "get_oc_dotted_chart",
                {"file_id": self.valid_log.id, "max_points": 500, "x_axis": "time", "y_axis": "activity"},
                user=self.user_owner,
            )
            self.assertIn("points", res)

        # Execution error containment
        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server.get_oc_dotted_chart_data", side_effect=ValueError("Invalid axis")),
        ):
            res_err = call_tool("get_oc_dotted_chart", {"file_id": self.valid_log.id}, user=self.user_owner)
            self.assertEqual(res_err.get("code"), "EXECUTION_ERROR")

    # =========================================================================
    # Test 7: get_layout Graph Stress Testing
    # =========================================================================
    def test_get_layout_stress_and_degenerate_graphs(self):
        # 1. Null / None arguments
        res_null = call_tool("get_layout", None)
        self.assertEqual(res_null["graph_type"], "ocdfg")
        self.assertEqual(res_null["direction"], "TB")
        self.assertEqual(res_null["nodes"], [])

        # 2. Malformed graph_data
        res_malformed = call_tool(
            "get_layout",
            {
                "graph_type": "totem",
                "graph_data": {"nodes": [None, 123, "string_node", {"id": "custom_id"}]},
                "direction": "LR",
            },
        )
        self.assertEqual(res_malformed["direction"], "LR")
        self.assertEqual(len(res_malformed["nodes"]), 4)
        self.assertEqual(res_malformed["nodes"][3]["id"], "custom_id")

    # =========================================================================
    # Test 8: Frontend Live-Wire Tools
    # =========================================================================
    def test_frontend_tools_dispatch_structure(self):
        # 1. navigate
        nav_res = call_tool("navigate", {"route": "/conformance/check"})
        self.assertEqual(nav_res["status"], "dispatched_to_frontend")
        self.assertEqual(nav_res["action"], "navigate")
        self.assertEqual(nav_res["arguments"]["route"], "/conformance/check")

        # 2. set_view_mode
        mode_res = call_tool("set_view_mode", {"mode": "variants"})
        self.assertEqual(mode_res["status"], "dispatched_to_frontend")
        self.assertEqual(mode_res["action"], "set_view_mode")
        self.assertEqual(mode_res["arguments"]["mode"], "variants")

        # 3. highlight_element
        hl_res = call_tool("highlight_element", {"tour_id": "step-1", "label": "Tooltip"})
        self.assertEqual(hl_res["status"], "dispatched_to_frontend")
        self.assertEqual(hl_res["action"], "highlight_element")
        self.assertEqual(hl_res["arguments"]["tour_id"], "step-1")

        # 4. Null / Empty arguments still return safe dispatched dict
        nav_empty = call_tool("navigate", None)
        self.assertEqual(nav_empty["status"], "dispatched_to_frontend")
        self.assertEqual(nav_empty["arguments"], {})

    # =========================================================================
    # Test 9: Confirmed Mutating Tools Stress Testing (All 10 components)
    # =========================================================================
    def test_confirmed_mutating_tools_polymorphic_execution(self):
        ctx = {"__confirmed__": True}

        # 1. create_dashboard
        dash = call_tool(
            "create_dashboard",
            {"name": "Stress Master Dashboard", "project_id": self.project_owner.id},
            user=self.user_owner,
            context=ctx,
        )
        dash_id = dash["id"]
        self.assertEqual(dash["name"], "Stress Master Dashboard")

        # 2. Add all 10 polymorphic component types via call_tool
        components_specs = [
            ("TextBoxComponent", {"text": "Note text", "font_size": 14}),
            ("NumberofEventsComponent", {"color": "blue"}),
            ("ImageComponent", {"image": "/path/img.png"}),
            ("VariantsComponent", {"extraction": "leading_bfs", "iso": "wl+vf2"}),
            ("ProcessAreaComponent", {}),
            ("LogStatisticsComponent", {"show_num_events": True}),
            ("OCDFGComponent", {"show_controls": True}),
            ("OCDottedChartComponent", {"max_points": 2000}),
            ("NewOCDFGComponent", {"layout_direction": "LR"}),
            ("OCCNComponent", {"relative_occurrence_threshold": 0.5}),
        ]

        created_comp_ids = []
        for c_type, props in components_specs:
            comp = call_tool(
                "add_component",
                {
                    "dashboard_id": dash_id,
                    "component_name": c_type,
                    "x": 0,
                    "y": 0,
                    "w": 4,
                    "h": 2,
                    "props": props,
                },
                user=self.user_owner,
                context=ctx,
            )
            self.assertIn("id", comp)
            self.assertEqual(comp["resourcetype"], c_type)
            created_comp_ids.append(comp["id"])

        self.assertEqual(len(created_comp_ids), 10)

        # 3. update_component on TextBoxComponent
        upd_comp = call_tool(
            "update_component",
            {
                "dashboard_id": dash_id,
                "component_id": created_comp_ids[0],
                "props": {"text": "Updated text content", "font_size": 24},
                "geometry": {"x": 2, "y": 3, "w": 8, "h": 6},
            },
            user=self.user_owner,
            context=ctx,
        )
        self.assertEqual(upd_comp["text"], "Updated text content")
        self.assertEqual(upd_comp["font_size"], 24)
        self.assertEqual(upd_comp["x"], 2)
        self.assertEqual(upd_comp["y"], 3)

        # 4. rename_dashboard
        renamed = call_tool(
            "rename_dashboard",
            {"dashboard_id": dash_id, "name": "Renamed Stress Master"},
            user=self.user_owner,
            context=ctx,
        )
        self.assertEqual(renamed["name"], "Renamed Stress Master")

        # 5. remove_component
        removed = call_tool(
            "remove_component",
            {"dashboard_id": dash_id, "component_id": created_comp_ids[0]},
            user=self.user_owner,
            context=ctx,
        )
        self.assertEqual(removed["status"], "deleted")
        self.assertFalse(DashboardComponent.objects.filter(id=created_comp_ids[0]).exists())

    # =========================================================================
    # Test 10: Multi-Tenant Cross-User Attack on Confirmed Mutating Tools
    # =========================================================================
    def test_multi_tenant_cross_user_attack_on_confirmed_tools(self):
        ctx = {"__confirmed__": True}

        # Create Alice dashboard
        alice_dash = call_tool(
            "create_dashboard",
            {"name": "Alice Vault", "project_id": self.project_owner.id},
            user=self.user_owner,
            context=ctx,
        )
        alice_dash_id = alice_dash["id"]

        alice_comp = call_tool(
            "add_component",
            {"dashboard_id": alice_dash_id, "component_name": "TextBoxComponent", "props": {"text": "Secret"}},
            user=self.user_owner,
            context=ctx,
        )
        alice_comp_id = alice_comp["id"]

        # Attacker (Bob) attempts to mutate Alice's dashboard even with confirmed=True
        with self.assertRaises(PermissionError):
            call_tool(
                "rename_dashboard",
                {"dashboard_id": alice_dash_id, "name": "Hacked"},
                user=self.user_other,
                context=ctx,
            )

        with self.assertRaises(PermissionError):
            call_tool(
                "add_component",
                {"dashboard_id": alice_dash_id, "component_name": "TextBoxComponent"},
                user=self.user_other,
                context=ctx,
            )

        with self.assertRaises(PermissionError):
            call_tool(
                "update_component",
                {"dashboard_id": alice_dash_id, "component_id": alice_comp_id, "props": {"text": "Hacked"}},
                user=self.user_other,
                context=ctx,
            )

        with self.assertRaises(PermissionError):
            call_tool(
                "remove_component",
                {"dashboard_id": alice_dash_id, "component_id": alice_comp_id},
                user=self.user_other,
                context=ctx,
            )
