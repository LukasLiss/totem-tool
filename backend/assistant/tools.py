"""
Teach Mode tool definitions for the assistant.

These define the tool schemas that the LLM sees for Teach Mode guidance
(e.g., showing UI paths). The MCP server tools (Act Mode) are defined
separately in mcp_server/server.py.
"""

TEACH_TOOLS = [
    {
        "name": "show_path",
        "description": (
            "Show the user a step-by-step path through the UI. "
            "Each step references a data-tour-id for highlighting."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "tour_id": {
                                "type": "string",
                                "description": "The data-tour-id to highlight.",
                            },
                            "label": {
                                "type": "string",
                                "description": "Instruction text for this step.",
                            },
                        },
                        "required": ["tour_id", "label"],
                    },
                    "description": "Ordered list of UI tour steps.",
                },
            },
            "required": ["steps"],
        },
    },
]
