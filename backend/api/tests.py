import json

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .ai import views as ai_views
from .ai.agent import run_agent
from .ai.tools import TOOL_SPECS, ToolContext, execute_tool
from .models import Dashboard, LogStatisticsComponent, Project, TextBoxComponent


class AiToolsTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="pw")
        self.other = User.objects.create_user(username="bob", password="pw")
        self.project = Project.objects.create(name="test_project")
        self.project.users.add(self.user)
        self.foreign_project = Project.objects.create(name="foreign")
        self.foreign_project.users.add(self.other)

    def run_tool(self, user, name, args):
        ctx = ToolContext(user=user)
        result = json.loads(execute_tool(ctx, name, args))
        return result, ctx.actions

    def test_create_dashboard(self):
        result, actions = self.run_tool(
            self.user, "create_dashboard", {"name": "My Dashboard", "project_id": self.project.id}
        )
        self.assertEqual(result["name"], "My Dashboard")
        self.assertTrue(Dashboard.objects.filter(id=result["dashboard_id"]).exists())
        self.assertIn({"type": "refresh_data"}, actions)

    def test_create_dashboard_assigns_incrementing_order(self):
        first, _ = self.run_tool(
            self.user, "create_dashboard", {"name": "One", "project_id": self.project.id}
        )
        second, _ = self.run_tool(
            self.user, "create_dashboard", {"name": "Two", "project_id": self.project.id}
        )
        orders = Dashboard.objects.filter(project=self.project).values_list(
            "order_in_project", flat=True
        )
        self.assertEqual(sorted(orders), [1, 2])
        self.assertNotEqual(first["dashboard_id"], second["dashboard_id"])

    def test_create_dashboard_rejects_foreign_project(self):
        result, _ = self.run_tool(
            self.user, "create_dashboard", {"name": "X", "project_id": self.foreign_project.id}
        )
        self.assertIn("error", result)
        self.assertFalse(Dashboard.objects.filter(project=self.foreign_project).exists())

    def test_rename_dashboard(self):
        dashboard = Dashboard.objects.create(project=self.project, name="Old", order_in_project=1)
        result, _ = self.run_tool(
            self.user, "rename_dashboard", {"dashboard_id": dashboard.id, "name": "New"}
        )
        self.assertEqual(result["name"], "New")
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.name, "New")

    def test_rename_foreign_dashboard_denied(self):
        dashboard = Dashboard.objects.create(
            project=self.foreign_project, name="Theirs", order_in_project=1
        )
        result, _ = self.run_tool(
            self.user, "rename_dashboard", {"dashboard_id": dashboard.id, "name": "Mine"}
        )
        self.assertIn("error", result)

    def test_add_component_stacks_below_existing(self):
        dashboard = Dashboard.objects.create(project=self.project, name="D", order_in_project=1)
        TextBoxComponent.objects.create(
            dashboard=dashboard, component_name="TextBoxComponent",
            x=0, y=0, w=12, h=2, text="Title",
        )
        result, actions = self.run_tool(
            self.user,
            "add_dashboard_component",
            {"dashboard_id": dashboard.id, "component_name": "LogStatisticsComponent"},
        )
        self.assertEqual(result["y"], 2)  # placed below the 2-row text box
        component = LogStatisticsComponent.objects.get(id=result["component_id"])
        self.assertTrue(component.show_num_events)
        self.assertIn({"type": "refresh_data"}, actions)

    def test_add_component_with_config(self):
        dashboard = Dashboard.objects.create(project=self.project, name="D", order_in_project=1)
        result, _ = self.run_tool(
            self.user,
            "add_dashboard_component",
            {
                "dashboard_id": dashboard.id,
                "component_name": "TextBoxComponent",
                "config": {"text": "Hello", "w": 12, "h": 1},
            },
        )
        component = TextBoxComponent.objects.get(id=result["component_id"])
        self.assertEqual(component.text, "Hello")
        self.assertEqual(component.w, 12)

    def test_add_component_rejects_unknown_type_and_fields(self):
        dashboard = Dashboard.objects.create(project=self.project, name="D", order_in_project=1)
        result, _ = self.run_tool(
            self.user,
            "add_dashboard_component",
            {"dashboard_id": dashboard.id, "component_name": "EvilComponent"},
        )
        self.assertIn("error", result)
        result, _ = self.run_tool(
            self.user,
            "add_dashboard_component",
            {
                "dashboard_id": dashboard.id,
                "component_name": "TextBoxComponent",
                "config": {"dashboard": 999},
            },
        )
        self.assertIn("error", result)

    def test_get_dashboard_layout(self):
        dashboard = Dashboard.objects.create(project=self.project, name="D", order_in_project=1)
        TextBoxComponent.objects.create(
            dashboard=dashboard, component_name="TextBoxComponent",
            x=0, y=0, w=6, h=1, text="Hi",
        )
        result, _ = self.run_tool(
            self.user, "get_dashboard_layout", {"dashboard_id": dashboard.id}
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["text"], "Hi")

    def test_navigate_user_actions(self):
        dashboard = Dashboard.objects.create(project=self.project, name="D", order_in_project=1)
        result, actions = self.run_tool(
            self.user, "navigate_user", {"target": "dashboard", "dashboard_id": dashboard.id}
        )
        self.assertEqual(result["status"], "ok")
        self.assertEqual(
            actions, [{"type": "navigate", "target": "dashboard", "dashboard_id": dashboard.id}]
        )
        result, actions = self.run_tool(
            self.user, "navigate_user", {"target": "analysis", "analysis_type": "bogus"}
        )
        self.assertIn("error", result)
        self.assertEqual(actions, [])

    def test_list_dashboards_scoped_to_user(self):
        Dashboard.objects.create(project=self.project, name="Mine", order_in_project=1)
        Dashboard.objects.create(project=self.foreign_project, name="Theirs", order_in_project=1)
        result, _ = self.run_tool(self.user, "list_dashboards", {})
        self.assertEqual([entry["name"] for entry in result], ["Mine"])


class FakeProvider:
    """Scripted provider: returns queued responses turn by turn."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def chat(self, system, messages, tools):
        self.calls.append({"system": system, "messages": list(messages), "tools": tools})
        return self.responses.pop(0)


class AgentLoopTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="pw")
        self.project = Project.objects.create(name="p")
        self.project.users.add(self.user)

    def test_plain_answer(self):
        provider = FakeProvider([{"content": "Hello!", "tool_calls": []}])
        new_messages, actions = run_agent(
            self.user, [{"role": "user", "content": "Hi"}], provider
        )
        self.assertEqual(len(new_messages), 1)
        self.assertEqual(new_messages[0]["content"], "Hello!")
        self.assertEqual(actions, [])
        self.assertEqual(provider.calls[0]["tools"], TOOL_SPECS)

    def test_tool_call_roundtrip(self):
        provider = FakeProvider(
            [
                {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "name": "create_dashboard",
                            "arguments": {"name": "KPIs", "project_id": self.project.id},
                        }
                    ],
                },
                {"content": "Created your dashboard!", "tool_calls": []},
            ]
        )
        new_messages, actions = run_agent(
            self.user, [{"role": "user", "content": "Make a dashboard"}], provider
        )
        self.assertTrue(Dashboard.objects.filter(name="KPIs").exists())
        roles = [message["role"] for message in new_messages]
        self.assertEqual(roles, ["assistant", "tool", "assistant"])
        tool_payload = json.loads(new_messages[1]["content"])
        self.assertEqual(tool_payload["name"], "KPIs")
        self.assertIn({"type": "refresh_data"}, actions)
        # second model call must see the tool result in history
        self.assertEqual(provider.calls[1]["messages"][-1]["role"], "tool")

    def test_iteration_cap(self):
        looping = {
            "content": "",
            "tool_calls": [{"id": "x", "name": "list_dashboards", "arguments": {}}],
        }
        provider = FakeProvider([looping] * 20)
        new_messages, _ = run_agent(
            self.user, [{"role": "user", "content": "loop"}], provider
        )
        self.assertLessEqual(len(provider.calls), 8)
        self.assertEqual(new_messages[-1]["role"], "assistant")
        self.assertIn("maximum number of tool steps", new_messages[-1]["content"])


class AiChatEndpointTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="pw")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_requires_authentication(self):
        client = APIClient()
        response = client.post("/api/ai/chat/", {"messages": []}, format="json")
        self.assertEqual(response.status_code, 401)

    def test_rejects_bad_history(self):
        response = self.client.post("/api/ai/chat/", {"messages": []}, format="json")
        self.assertEqual(response.status_code, 400)
        response = self.client.post(
            "/api/ai/chat/",
            {"messages": [{"role": "assistant", "content": "hi"}]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_chat_turn_with_fake_provider(self):
        fake = FakeProvider([{"content": "Hi there", "tool_calls": []}])
        original = ai_views.build_provider
        ai_views.build_provider = lambda *args, **kwargs: fake
        try:
            response = self.client.post(
                "/api/ai/chat/",
                {"messages": [{"role": "user", "content": "Hello"}]},
                format="json",
            )
        finally:
            ai_views.build_provider = original
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["messages"][0]["content"], "Hi there")
        self.assertEqual(response.data["actions"], [])

    def test_config_endpoint(self):
        response = self.client.get("/api/ai/config/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("default_provider", response.data)
        self.assertIn("default_models", response.data)
