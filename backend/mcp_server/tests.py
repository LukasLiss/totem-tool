"""
Unit tests for MCP Server schemas and policy engine.
"""

from django.test import TestCase
from .policy import ToolCategory, get_category, is_mutable, TOOL_CATEGORIES
from .server import get_tool_specs, call_tool


class McpServerTests(TestCase):
    def test_total_tool_count_is_18(self):
        specs = get_tool_specs()
        self.assertEqual(len(specs), 18)
        self.assertEqual(len(TOOL_CATEGORIES), 18)

    def test_all_specs_have_valid_structure(self):
        for spec in get_tool_specs():
            self.assertIn("name", spec)
            self.assertIn("description", spec)
            self.assertIn("parameters", spec)
            params = spec["parameters"]
            self.assertEqual(params.get("type"), "object")
            self.assertIn("properties", params)
            self.assertIn("required", params)

    def test_policy_classification(self):
        self.assertEqual(get_category("get_statistics"), ToolCategory.READ_ONLY)
        self.assertEqual(get_category("create_dashboard"), ToolCategory.MUTATING)
        self.assertEqual(get_category("navigate"), ToolCategory.REQUIRES_FRONTEND)

    def test_is_mutable_logic(self):
        self.assertFalse(is_mutable("get_statistics"))
        self.assertTrue(is_mutable("create_dashboard"))
        self.assertTrue(is_mutable("navigate"))

    def test_unknown_tool_raises_error(self):
        with self.assertRaises(ValueError):
            get_category("invalid_tool_name")

    def test_call_tool_scaffolding(self):
        result = call_tool("get_statistics", {})
        self.assertIn("num_events", result)
