# AI Assistant

The TOTeM tool ships with a built-in AI chat assistant. It can

- **create and edit dashboards** (create/rename dashboards, add components
  such as log statistics, variants explorer, OC-DFG, dotted chart, …),
- **navigate the user** to the right view (upload, overview, analysis views,
  a specific dashboard), and
- **answer "how do I …?" questions** about the tool itself.

Open it via the floating bot button in the bottom-right corner of the app
(available on all views once logged in).

## Choosing an AI provider

The gear icon in the chat header opens the settings. Three providers are
supported:

| Provider | What you need | Default model |
| --- | --- | --- |
| **Ollama** (local, default) | [Ollama](https://ollama.com) running locally with a tool-calling model pulled (e.g. `ollama pull llama3.1`) | `llama3.1` |
| **Anthropic (Claude)** | An Anthropic API key | `claude-opus-4-8` |
| **OpenAI (ChatGPT)** | An OpenAI API key | `gpt-4o` |

Settings (provider, model, API key, Ollama URL) are stored in the browser's
`localStorage` and sent along with each chat request. Alternatively the
backend can be configured with environment variables, which act as defaults
whenever the frontend does not provide a value:

```
AI_PROVIDER=anthropic          # ollama | anthropic | openai
AI_MODEL=claude-opus-4-8       # optional model override
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
OLLAMA_BASE_URL=http://localhost:11434
```

> Note: for Ollama, pick a model that supports **tool calling** — otherwise
> the assistant can chat but cannot create dashboards or navigate.

## Architecture

```
Chat widget (React)            Django backend                    LLM provider
┌──────────────────┐  POST     ┌───────────────────────────┐     ┌──────────┐
│ message history  │ ────────▶ │ /api/ai/chat/             │ ──▶ │ Ollama / │
│ + settings       │           │  agent loop (api/ai/)     │ ◀── │ Claude / │
│                  │ ◀──────── │  MCP-style tool registry  │     │ OpenAI   │
│ executes actions │  messages │  (scoped to request.user) │     └──────────┘
└──────────────────┘  +actions └───────────────────────────┘
```

- **`backend/api/ai/tools.py`** — MCP-style tool registry. Each tool has a
  JSON-Schema declaration (like an MCP server would expose) and runs
  in-process against the Django models, always scoped to the authenticated
  user. Tools: `list_event_logs`, `list_dashboards`, `create_dashboard`,
  `rename_dashboard`, `get_dashboard_layout`, `add_dashboard_component`,
  `navigate_user`.
- **`backend/api/ai/providers.py`** — provider clients (plain HTTP, no
  vendor SDKs) that translate a neutral message/tool format to the Ollama,
  Anthropic and OpenAI wire formats.
- **`backend/api/ai/agent.py`** — the agent loop (max 8 tool steps per turn)
  and the system prompt describing the tool's features.
- **`backend/api/ai/views.py`** — `POST /api/ai/chat/` (one assistant turn)
  and `GET /api/ai/config/` (backend defaults for the settings UI).
- **Frontend actions** — tools that manipulate the user's view don't touch
  the UI directly; they queue predefined actions that are returned to the
  browser, e.g. `{"type": "navigate", "target": "dashboard",
  "dashboard_id": 5}` or `{"type": "refresh_data"}`. The chat widget
  (`frontend/src/components/ai-chat/chat-widget.tsx`) executes them via the
  router and `DashboardContext`, and the sidebar refetches data on the
  `totem:refresh-data` window event.

The backend is stateless: the frontend owns the conversation history
(session-scoped in `sessionStorage`) and sends it with every request; the
backend returns the new assistant/tool messages to append.

## API

`POST /api/ai/chat/` (JWT auth required)

```jsonc
{
  "messages": [{ "role": "user", "content": "Create a KPI dashboard" }],
  "settings": {              // all fields optional, env vars as fallback
    "provider": "anthropic", // ollama | anthropic | openai
    "model": "",
    "api_key": "sk-ant-...",
    "ollama_base_url": "http://localhost:11434"
  }
}
```

Response:

```jsonc
{
  "messages": [ /* new assistant + tool messages to append */ ],
  "actions":  [ { "type": "refresh_data" },
                { "type": "navigate", "target": "dashboard", "dashboard_id": 5 } ]
}
```

Errors: `400` for malformed history, `502` with `{"error": "..."}` when the
provider is unreachable/misconfigured.
