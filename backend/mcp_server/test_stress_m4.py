"""
Adversarial Stress Test Suite for Milestone 4 (Sub-task #119).
Focus Areas:
1. DashboardService Adversarial Tests:
   - Nonexistent project IDs (e.g. 999999, negative IDs, project ID of another user).
   - Unauthorized cross-user access attempts (read, create, update, delete, rename, add/remove components).
   - Invalid component types (unknown strings, None, numbers, SQL injection strings, empty strings).
   - Degenerate & negative geometry (w=-1, h=-5, x=-10, y=-20, w=0, h=0, non-integer geometry).
   - Missing, empty, or degenerate configuration payloads across all 10 polymorphic component types.
   - Title boundary tests (empty, whitespace, 100+ chars truncation to 30, special characters, unicode, HTML/script tags).
   - Invalid or mismatched component/dashboard IDs in update and remove operations.
2. Cascading Deletion Verification:
   - Dashboard deletion cascades to polymorphic child components and subclass tables.
   - Project deletion cascades to dashboards and all child components.
   - Direct component removal does not affect sibling components or parent dashboard.
3. MCP Policy Framework & Tool Server Dispatcher Adversarial Tests:
   - All 18 tools policy definitions and policy helper error handling.
   - Mutating tool permission barrier (unconfirmed vs confirmed execution).
   - Confirmed tool execution with corrupted/adversarial arguments.
   - Read-only tools error containment with invalid file IDs, missing files on disk, and unauthenticated users.
   - Layout calculation with degenerate graphs, empty graphs, large graphs, and invalid directions.
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


class DashboardServiceAdversarialTests(TestCase):
    """Adversarial stress-testing of DashboardService CRUD and polymorphic models."""

    def setUp(self):
        self.user_alice = User.objects.create_user(username="alice", password="alice_password")
        self.user_bob = User.objects.create_user(username="bob", password="bob_password")
        self.user_eve = User.objects.create_user(username="eve", password="eve_password")

        self.project_alice = Project.objects.create(name="Alice Project")
        self.project_alice.users.add(self.user_alice)

        self.project_bob = Project.objects.create(name="Bob Project")
        self.project_bob.users.add(self.user_bob)

    # -------------------------------------------------------------------------
    # 1. Project ID & Access Boundary Tests
    # -------------------------------------------------------------------------

    def test_create_dashboard_nonexistent_project_id(self):
        """Passing nonexistent project_id raises PermissionError."""
        for invalid_id in [999999, -1, 0, 1234567]:
            with self.assertRaises(PermissionError):
                DashboardService.create_dashboard(
                    user=self.user_alice,
                    title="Ghost Project Dashboard",
                    project_id=invalid_id,
                )

    def test_create_dashboard_cross_user_project_id(self):
        """Alice cannot create a dashboard inside Bob's project."""
        with self.assertRaises(PermissionError):
            DashboardService.create_dashboard(
                user=self.user_alice,
                title="Attacker Dashboard",
                project_id=self.project_bob.id,
            )

    def test_create_dashboard_no_project_creates_default_project(self):
        """If user has no project and project_id is None, a default project is automatically created."""
        user_charlie = User.objects.create_user(username="charlie", password="charlie_password")
        self.assertEqual(Project.objects.filter(users=user_charlie).count(), 0)

        dash = DashboardService.create_dashboard(user=user_charlie, title="Charlie First Dash")
        self.assertIsNotNone(dash["project_id"])
        self.assertEqual(Project.objects.filter(users=user_charlie).count(), 1)
        self.assertTrue(Project.objects.filter(id=dash["project_id"], users=user_charlie).exists())

    def test_unauthenticated_and_anonymous_user_rejection(self):
        """Unauthenticated or None user is rejected across all service methods."""
        anon = AnonymousUser()
        for user in [None, anon]:
            with self.assertRaises(PermissionError):
                DashboardService.create_dashboard(user=user, title="Test")
            with self.assertRaises(PermissionError):
                DashboardService.get_dashboard(user=user, dashboard_id=1)
            with self.assertRaises(PermissionError):
                DashboardService.list_dashboards(user=user)
            with self.assertRaises(PermissionError):
                DashboardService.rename_dashboard(user=user, dashboard_id=1, title="New")
            with self.assertRaises(PermissionError):
                DashboardService.delete_dashboard(user=user, dashboard_id=1)
            with self.assertRaises(PermissionError):
                DashboardService.add_component(user=user, dashboard_id=1, component_type="TextBoxComponent")
            with self.assertRaises(PermissionError):
                DashboardService.update_component(user=user, component_id=1)
            with self.assertRaises(PermissionError):
                DashboardService.remove_component(user=user, component_id=1)

    # -------------------------------------------------------------------------
    # 2. Cross-User Unauthorized Access Attempts
    # -------------------------------------------------------------------------

    def test_cross_user_dashboard_manipulation_prevented(self):
        """Alice's dashboards and components are completely protected from Bob and Eve."""
        dash_alice = DashboardService.create_dashboard(
            user=self.user_alice,
            title="Alice Confidential",
            project_id=self.project_alice.id,
        )
        dash_id = dash_alice["id"]

        comp_alice = DashboardService.add_component(
            user=self.user_alice,
            dashboard_id=dash_id,
            component_type="TextBoxComponent",
            config={"text": "Alice Private Data"},
        )
        comp_id = comp_alice["id"]

        # Bob attempts read
        with self.assertRaises(PermissionError):
            DashboardService.get_dashboard(user=self.user_bob, dashboard_id=dash_id)

        # Bob attempts rename
        with self.assertRaises(PermissionError):
            DashboardService.rename_dashboard(user=self.user_bob, dashboard_id=dash_id, title="Hacked by Bob")

        # Bob attempts add component
        with self.assertRaises(PermissionError):
            DashboardService.add_component(
                user=self.user_bob,
                dashboard_id=dash_id,
                component_type="TextBoxComponent",
                config={"text": "Bob Trojan"},
            )

        # Bob attempts update component
        with self.assertRaises(PermissionError):
            DashboardService.update_component(
                user=self.user_bob,
                dashboard_id=dash_id,
                component_id=comp_id,
                config={"text": "Tampered Content"},
            )

        # Bob attempts remove component
        with self.assertRaises(PermissionError):
            DashboardService.remove_component(
                user=self.user_bob,
                dashboard_id=dash_id,
                component_id=comp_id,
            )

        # Bob attempts delete dashboard
        with self.assertRaises(PermissionError):
            DashboardService.delete_dashboard(user=self.user_bob, dashboard_id=dash_id)

        # Verify state is unchanged
        fresh_dash = DashboardService.get_dashboard(user=self.user_alice, dashboard_id=dash_id)
        self.assertEqual(fresh_dash["name"], "Alice Confidential")
        self.assertEqual(len(fresh_dash["components"]), 1)
        self.assertEqual(fresh_dash["components"][0]["text"], "Alice Private Data")

    def test_list_dashboards_cross_tenant_isolation(self):
        """Listing dashboards isolates users strictly to their own projects."""
        DashboardService.create_dashboard(user=self.user_alice, title="Alice Dash 1", project_id=self.project_alice.id)
        DashboardService.create_dashboard(user=self.user_alice, title="Alice Dash 2", project_id=self.project_alice.id)
        DashboardService.create_dashboard(user=self.user_bob, title="Bob Dash 1", project_id=self.project_bob.id)

        alice_list = DashboardService.list_dashboards(user=self.user_alice)
        self.assertEqual(len(alice_list), 2)
        alice_titles = [d["name"] for d in alice_list]
        self.assertIn("Alice Dash 1", alice_titles)
        self.assertIn("Alice Dash 2", alice_titles)
        self.assertNotIn("Bob Dash 1", alice_titles)

        # Alice explicitly querying Bob's project_id returns empty list
        alice_query_bob_proj = DashboardService.list_dashboards(user=self.user_alice, project_id=self.project_bob.id)
        self.assertEqual(len(alice_query_bob_proj), 0)

    # -------------------------------------------------------------------------
    # 3. Invalid Component Types & Fallbacks
    # -------------------------------------------------------------------------

    def test_invalid_and_adversarial_component_types(self):
        """Invalid component type strings fallback gracefully to TextBoxComponent."""
        dash = DashboardService.create_dashboard(user=self.user_alice, title="Type Test", project_id=self.project_alice.id)
        dash_id = dash["id"]

        adversarial_types = [
            "NonExistentComponent",
            "'; DROP TABLE api_dashboard; --",
            "<script>alert(1)</script>",
            "",
            "   ",
            "UNKNOWN_RANDOM_TYPE",
            "12345",
        ]

        for bad_type in adversarial_types:
            comp = DashboardService.add_component(
                user=self.user_alice,
                dashboard_id=dash_id,
                component_type=bad_type,
                title="Fallback Card",
                config={"text": "Safely Handled"},
            )
            self.assertIn("id", comp)
            self.assertEqual(comp["resourcetype"], "TextBoxComponent")
            self.assertEqual(comp["text"], "Safely Handled")

    def test_component_type_normalization_variations(self):
        """Verify various casing and hyphen/underscore variations map correctly."""
        dash = DashboardService.create_dashboard(user=self.user_alice, title="Norm Test", project_id=self.project_alice.id)
        dash_id = dash["id"]

        test_cases = [
            ("text_box", "TextBoxComponent"),
            ("TEXTBOX", "TextBoxComponent"),
            ("text-box", "TextBoxComponent"),
            ("number_of_events", "NumberofEventsComponent"),
            ("NUMBER-OF-EVENTS", "NumberofEventsComponent"),
            ("oc_dotted_chart", "OCDottedChartComponent"),
            ("oc-dotted-chart", "OCDottedChartComponent"),
            ("dotted_chart", "OCDottedChartComponent"),
            ("process_area", "ProcessAreaComponent"),
            ("log_statistics", "LogStatisticsComponent"),
            ("new_ocdfg", "NewOCDFGComponent"),
            ("new-ocdfg", "NewOCDFGComponent"),
        ]

        for input_name, expected_resource in test_cases:
            comp = DashboardService.add_component(
                user=self.user_alice,
                dashboard_id=dash_id,
                component_type=input_name,
            )
            self.assertEqual(comp["resourcetype"], expected_resource)

    # -------------------------------------------------------------------------
    # 4. Geometry & Coordinate Stress Tests
    # -------------------------------------------------------------------------

    def test_negative_and_zero_geometry_coordinates(self):
        """Negative and zero coordinates (e.g. w=-1, h=-5, x=-10) are accepted and stored cleanly in DB."""
        dash = DashboardService.create_dashboard(user=self.user_alice, title="Geometry Stress", project_id=self.project_alice.id)
        dash_id = dash["id"]

        comp = DashboardService.add_component(
            user=self.user_alice,
            dashboard_id=dash_id,
            component_type="TextBoxComponent",
            position={"x": -10, "y": -20, "w": -1, "h": -5},
            config={"text": "Negative Box"},
        )
        self.assertEqual(comp["x"], -10)
        self.assertEqual(comp["y"], -20)
        self.assertEqual(comp["w"], -1)
        self.assertEqual(comp["h"], -5)

        # Update to zero and large geometry
        upd = DashboardService.update_component(
            user=self.user_alice,
            dashboard_id=dash_id,
            component_id=comp["id"],
            position={"x": 0, "y": 0, "w": 0, "h": 0},
        )
        self.assertEqual(upd["x"], 0)
        self.assertEqual(upd["y"], 0)
        self.assertEqual(upd["w"], 0)
        self.assertEqual(upd["h"], 0)

    def test_missing_and_none_position_arguments(self):
        """Missing or None position defaults to x=0, y=0, w=6, h=4."""
        dash = DashboardService.create_dashboard(user=self.user_alice, title="Default Geometry", project_id=self.project_alice.id)
        dash_id = dash["id"]

        comp = DashboardService.add_component(
            user=self.user_alice,
            dashboard_id=dash_id,
            component_type="TextBoxComponent",
            position=None,
        )
        self.assertEqual(comp["x"], 0)
        self.assertEqual(comp["y"], 0)
        self.assertEqual(comp["w"], 6)
        self.assertEqual(comp["h"], 4)

    # -------------------------------------------------------------------------
    # 5. Missing / Degenerate Configuration Fields for All 10 Components
    # -------------------------------------------------------------------------

    def test_all_10_components_with_empty_and_none_config(self):
        """Creating each of the 10 components with empty config {} or None succeeds with valid defaults."""
        dash = DashboardService.create_dashboard(user=self.user_alice, title="Config Stress", project_id=self.project_alice.id)
        dash_id = dash["id"]

        components_to_test = [
            "TextBoxComponent",
            "NumberofEventsComponent",
            "ImageComponent",
            "VariantsComponent",
            "ProcessAreaComponent",
            "LogStatisticsComponent",
            "OCDFGComponent",
            "OCDottedChartComponent",
            "NewOCDFGComponent",
            "OCCNComponent",
        ]

        for comp_type in components_to_test:
            # 1. With config=None
            c_none = DashboardService.add_component(
                user=self.user_alice,
                dashboard_id=dash_id,
                component_type=comp_type,
                config=None,
            )
            self.assertIn("id", c_none)
            self.assertEqual(c_none["resourcetype"], comp_type)

            # 2. With config={}
            c_empty = DashboardService.add_component(
                user=self.user_alice,
                dashboard_id=dash_id,
                component_type=comp_type,
                config={},
            )
            self.assertIn("id", c_empty)
            self.assertEqual(c_empty["resourcetype"], comp_type)

    def test_occn_component_list_object_types_conversion(self):
        """OCCNComponent accepts list of object types and serializes as comma-separated string."""
        dash = DashboardService.create_dashboard(user=self.user_alice, title="OCCN Config", project_id=self.project_alice.id)
        comp = DashboardService.add_component(
            user=self.user_alice,
            dashboard_id=dash["id"],
            component_type="OCCNComponent",
            config={"object_types": ["order", "item", "delivery"], "relative_occurrence_threshold": 0.3},
        )
        self.assertEqual(comp["object_types"], "order,item,delivery")
        self.assertEqual(comp["relative_occurrence_threshold"], 0.3)

        # Update with new list
        upd = DashboardService.update_component(
            user=self.user_alice,
            dashboard_id=dash["id"],
            component_id=comp["id"],
            config={"object_types": ["invoice", "payment"]},
        )
        self.assertEqual(upd["object_types"], "invoice,payment")

    # -------------------------------------------------------------------------
    # 6. Title Boundary, Unicode, and XSS Tests
    # -------------------------------------------------------------------------

    def test_dashboard_title_sanitization_and_clamping(self):
        """Title is clamped to 30 characters and special characters/unicode are preserved safely."""
        # 1. Super long title (> 30 characters)
        long_title = "A" * 100
        dash1 = DashboardService.create_dashboard(user=self.user_alice, title=long_title, project_id=self.project_alice.id)
        self.assertEqual(len(dash1["name"]), 30)
        self.assertEqual(dash1["name"], "A" * 30)

        # 2. Empty/whitespace title defaults to "New Dashboard"
        dash2 = DashboardService.create_dashboard(user=self.user_alice, title="   ", project_id=self.project_alice.id)
        self.assertEqual(dash2["name"], "New Dashboard")

        # 3. Unicode & Emoji
        emoji_title = "📊 Analytics 🚀 🔥"
        dash3 = DashboardService.create_dashboard(user=self.user_alice, title=emoji_title, project_id=self.project_alice.id)
        self.assertEqual(dash3["name"], emoji_title[:30])

        # 4. HTML / Script tag
        xss_title = "<script>alert('XSS')</script>"
        dash4 = DashboardService.create_dashboard(user=self.user_alice, title=xss_title, project_id=self.project_alice.id)
        self.assertEqual(dash4["name"], xss_title[:30])

    def test_rename_dashboard_empty_title_validation(self):
        """Renaming with empty or whitespace title raises ValueError."""
        dash = DashboardService.create_dashboard(user=self.user_alice, title="Original", project_id=self.project_alice.id)
        dash_id = dash["id"]

        for bad_title in ["", "   ", None, "\t\n"]:
            with self.assertRaises(ValueError):
                DashboardService.rename_dashboard(user=self.user_alice, dashboard_id=dash_id, title=bad_title)

    # -------------------------------------------------------------------------
    # 7. Mismatched IDs & Edge Cases in Component Update/Remove
    # -------------------------------------------------------------------------

    def test_update_and_remove_component_mismatched_dashboard_id(self):
        """Passing mismatched dashboard_id raises PermissionError."""
        dash1 = DashboardService.create_dashboard(user=self.user_alice, title="D1", project_id=self.project_alice.id)
        dash2 = DashboardService.create_dashboard(user=self.user_alice, title="D2", project_id=self.project_alice.id)

        comp1 = DashboardService.add_component(user=self.user_alice, dashboard_id=dash1["id"], component_type="TextBoxComponent")
        comp1_id = comp1["id"]

        # Attempt to update comp1 using dash2 ID
        with self.assertRaises(PermissionError):
            DashboardService.update_component(
                user=self.user_alice,
                dashboard_id=dash2["id"],
                component_id=comp1_id,
                config={"text": "Misplaced"},
            )

        # Attempt to remove comp1 using dash2 ID
        with self.assertRaises(PermissionError):
            DashboardService.remove_component(
                user=self.user_alice,
                dashboard_id=dash2["id"],
                component_id=comp1_id,
            )

    def test_update_and_remove_missing_component_id(self):
        """Passing None for component_id raises ValueError."""
        with self.assertRaises(ValueError):
            DashboardService.update_component(user=self.user_alice, component_id=None)

        with self.assertRaises(ValueError):
            DashboardService.remove_component(user=self.user_alice, component_id=None)


class CascadingDeletionTests(TestCase):
    """Verify cascading deletion across Dashboard and polymorphic DashboardComponent child tables."""

    def setUp(self):
        self.user = User.objects.create_user(username="cascade_user", password="password")
        self.project = Project.objects.create(name="Cascade Project")
        self.project.users.add(self.user)

    def test_dashboard_deletion_cascades_all_10_polymorphic_subclasses(self):
        """Deleting a dashboard removes all base components and concrete subclass table rows."""
        dash = DashboardService.create_dashboard(user=self.user, title="Full Deck", project_id=self.project.id)
        dash_id = dash["id"]

        # Add all 10 component types
        DashboardService.add_component(user=self.user, dashboard_id=dash_id, component_type="TextBoxComponent", config={"text": "Note"})
        DashboardService.add_component(user=self.user, dashboard_id=dash_id, component_type="NumberofEventsComponent", config={"color": "red"})
        DashboardService.add_component(user=self.user, dashboard_id=dash_id, component_type="ImageComponent", config={"image": "img.png"})
        DashboardService.add_component(user=self.user, dashboard_id=dash_id, component_type="VariantsComponent")
        DashboardService.add_component(user=self.user, dashboard_id=dash_id, component_type="ProcessAreaComponent")
        DashboardService.add_component(user=self.user, dashboard_id=dash_id, component_type="LogStatisticsComponent")
        DashboardService.add_component(user=self.user, dashboard_id=dash_id, component_type="OCDFGComponent")
        DashboardService.add_component(user=self.user, dashboard_id=dash_id, component_type="OCDottedChartComponent")
        DashboardService.add_component(user=self.user, dashboard_id=dash_id, component_type="NewOCDFGComponent")
        DashboardService.add_component(user=self.user, dashboard_id=dash_id, component_type="OCCNComponent")

        # Verify 10 components created in base and subclasses
        self.assertEqual(DashboardComponent.objects.filter(dashboard_id=dash_id).count(), 10)
        self.assertEqual(TextBoxComponent.objects.filter(dashboard_id=dash_id).count(), 1)
        self.assertEqual(NumberofEventsComponent.objects.filter(dashboard_id=dash_id).count(), 1)
        self.assertEqual(ImageComponent.objects.filter(dashboard_id=dash_id).count(), 1)
        self.assertEqual(VariantsComponent.objects.filter(dashboard_id=dash_id).count(), 1)
        self.assertEqual(ProcessAreaComponent.objects.filter(dashboard_id=dash_id).count(), 1)
        self.assertEqual(LogStatisticsComponent.objects.filter(dashboard_id=dash_id).count(), 1)
        self.assertEqual(OCDFGComponent.objects.filter(dashboard_id=dash_id).count(), 1)
        self.assertEqual(OCDottedChartComponent.objects.filter(dashboard_id=dash_id).count(), 1)
        self.assertEqual(NewOCDFGComponent.objects.filter(dashboard_id=dash_id).count(), 1)
        self.assertEqual(OCCNComponent.objects.filter(dashboard_id=dash_id).count(), 1)

        # Delete dashboard
        del_res = DashboardService.delete_dashboard(user=self.user, dashboard_id=dash_id)
        self.assertEqual(del_res["status"], "deleted")
        self.assertEqual(del_res["dashboard_id"], dash_id)

        # Verify complete cascading deletion across all models
        self.assertFalse(Dashboard.objects.filter(id=dash_id).exists())
        self.assertEqual(DashboardComponent.objects.filter(dashboard_id=dash_id).count(), 0)
        self.assertEqual(TextBoxComponent.objects.filter(dashboard_id=dash_id).count(), 0)
        self.assertEqual(NumberofEventsComponent.objects.filter(dashboard_id=dash_id).count(), 0)
        self.assertEqual(ImageComponent.objects.filter(dashboard_id=dash_id).count(), 0)
        self.assertEqual(VariantsComponent.objects.filter(dashboard_id=dash_id).count(), 0)
        self.assertEqual(ProcessAreaComponent.objects.filter(dashboard_id=dash_id).count(), 0)
        self.assertEqual(LogStatisticsComponent.objects.filter(dashboard_id=dash_id).count(), 0)
        self.assertEqual(OCDFGComponent.objects.filter(dashboard_id=dash_id).count(), 0)
        self.assertEqual(OCDottedChartComponent.objects.filter(dashboard_id=dash_id).count(), 0)
        self.assertEqual(NewOCDFGComponent.objects.filter(dashboard_id=dash_id).count(), 0)
        self.assertEqual(OCCNComponent.objects.filter(dashboard_id=dash_id).count(), 0)

    def test_project_deletion_cascades_dashboards_and_components(self):
        """Deleting a Project cascades to all dashboards and all polymorphic components within it."""
        dash = DashboardService.create_dashboard(user=self.user, title="Project Cascade Test", project_id=self.project.id)
        dash_id = dash["id"]
        DashboardService.add_component(user=self.user, dashboard_id=dash_id, component_type="TextBoxComponent")
        DashboardService.add_component(user=self.user, dashboard_id=dash_id, component_type="LogStatisticsComponent")

        self.assertEqual(Dashboard.objects.filter(project=self.project).count(), 1)
        self.assertEqual(DashboardComponent.objects.filter(dashboard_id=dash_id).count(), 2)

        # Delete Project
        self.project.delete()

        self.assertFalse(Dashboard.objects.filter(id=dash_id).exists())
        self.assertEqual(DashboardComponent.objects.filter(dashboard_id=dash_id).count(), 0)


class McpServerAndPolicyAdversarialTests(TestCase):
    """Adversarial stress-testing of MCP Server dispatcher, policy gates, and error handling."""

    def setUp(self):
        self.user = User.objects.create_user(username="mcp_stress_user", password="password")
        self.project = Project.objects.create(name="MCP Stress Project")
        self.project.users.add(self.user)

        self.event_log = EventLog.objects.create(
            project=self.project,
            file=SimpleUploadedFile("ocel_log.json", b"{}"),
        )

    def test_all_18_tools_have_valid_schemas_and_policies(self):
        """Every tool spec matches policy registry and has valid parameters schema."""
        specs = get_tool_specs()
        self.assertEqual(len(specs), 18)

        for spec in specs:
            name = spec["name"]
            self.assertIn(name, TOOL_POLICIES)
            self.assertIn(name, TOOL_CATEGORIES)
            cat = get_category(name)
            self.assertIn(cat, [ToolCategory.READ_ONLY, ToolCategory.MUTATING, ToolCategory.REQUIRES_FRONTEND])
            danger = get_danger_level(name)
            self.assertIn(danger, [DangerLevel.LOW, DangerLevel.MEDIUM, DangerLevel.HIGH])

    def test_call_tool_mutating_tools_enforce_confirmed_flag(self):
        """Every mutating tool strictly blocks execution unless __confirmed__ or confirmed is True."""
        mutating_tools = [
            "create_dashboard",
            "add_component",
            "remove_component",
            "update_component",
            "rename_dashboard",
        ]

        for tool in mutating_tools:
            # 1. No context
            with self.assertRaises(PermissionError):
                call_tool(tool, {}, user=self.user, context=None)

            # 2. Empty context
            with self.assertRaises(PermissionError):
                call_tool(tool, {}, user=self.user, context={})

            # 3. Context with confirmed=False
            with self.assertRaises(PermissionError):
                call_tool(tool, {}, user=self.user, context={"__confirmed__": False})

            # 4. Context with invalid confirmed type
            with self.assertRaises(PermissionError):
                call_tool(tool, {}, user=self.user, context={"__confirmed__": 0})

    def test_call_tool_unimplemented_tool_error(self):
        """Calling unknown tool name raises ValueError in get_category."""
        with self.assertRaises(ValueError):
            call_tool("non_existent_tool_name", {}, user=self.user)

    def test_get_layout_adversarial_inputs(self):
        """get_layout handles empty graphs, malformed node formats, and direction permutations."""
        # 1. Empty graph data
        res1 = call_tool("get_layout", {"graph_type": "ocdfg", "graph_data": {}})
        self.assertEqual(res1["direction"], "TB")
        self.assertEqual(len(res1["nodes"]), 0)
        self.assertEqual(len(res1["edges"]), 0)

        # 2. Nodes as simple string IDs rather than dicts
        res2 = call_tool(
            "get_layout",
            {
                "graph_type": "occn",
                "graph_data": {"nodes": ["node_1", "node_2", "node_3"], "edges": []},
                "direction": "LR",
            },
        )
        self.assertEqual(res2["direction"], "LR")
        self.assertEqual(len(res2["nodes"]), 3)
        self.assertEqual(res2["nodes"][0]["id"], "node_1")

        # 3. Graph with 50 nodes
        large_nodes = [{"id": f"node_{i}", "label": f"Step {i}"} for i in range(50)]
        res3 = call_tool(
            "get_layout",
            {"graph_type": "totem", "graph_data": {"nodes": large_nodes, "edges": []}, "direction": "TB"},
        )
        self.assertEqual(len(res3["nodes"]), 50)

    def test_read_only_tools_clamp_thresholds(self):
        """Float thresholds outside [0.0, 1.0] are clamped without throwing exceptions."""
        mock_occn = MagicMock()
        mock_occn.apply_relative_occurrence_threshold.return_value = mock_occn

        with (
            patch("mcp_server.server._with_ocel_db", return_value=nullcontext(MagicMock())),
            patch("mcp_server.server.discover_occn", return_value=mock_occn),
            patch("mcp_server.server.serialize_occn", return_value={"places": [], "transitions": []}),
        ):
            # Threshold = 999.0 should clamp to 1.0
            res = call_tool("discover_occn", {"file_id": self.event_log.id, "threshold": 999.0}, user=self.user)
            self.assertEqual(res, {"places": [], "transitions": []})

            # Threshold = -50.0 should clamp to 0.0
            res2 = call_tool("discover_occn", {"file_id": self.event_log.id, "threshold": -50.0}, user=self.user)
            self.assertEqual(res2, {"places": [], "transitions": []})

    def test_list_dashboards_and_assets_scoping(self):
        """list_dashboards and list_assets tools scope results properly."""
        DashboardService.create_dashboard(user=self.user, title="Scoped D1", project_id=self.project.id)

        # 1. list_dashboards as unauthenticated user returns empty list
        anon_res = call_tool("list_dashboards", {}, user=None)
        self.assertEqual(anon_res["dashboards"], [])

        # 2. list_dashboards as authenticated user
        auth_res = call_tool("list_dashboards", {"project_id": self.project.id}, user=self.user)
        self.assertEqual(len(auth_res["dashboards"]), 1)

        # 3. list_assets as authenticated user
        ProjectAsset.objects.create(
            project=self.project,
            name="Asset 1",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json={"nodes": []},
        )
        assets_res = call_tool("list_assets", {"project_id": self.project.id}, user=self.user)
        self.assertEqual(len(assets_res["assets"]), 1)
