import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  streamChat,
  sendChat,
  confirmAction,
  AssistantContext,
  PendingAction,
  TourStep,
  ChatResponse,
  SSEEvent,
} from "../assistantApi";
import axios from "axios";

vi.mock("axios");

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

describe("assistantApi contracts and streaming generator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Type interfaces contract checks", () => {
    it("conforms to AssistantContext contract", () => {
      const ctx: AssistantContext = {
        selected_file_id: 42,
        current_view: "dashboard",
        current_dashboard_id: 101,
      };
      expect(ctx.selected_file_id).toBe(42);
      expect(ctx.current_view).toBe("dashboard");
      expect(ctx.current_dashboard_id).toBe(101);
    });

    it("conforms to PendingAction contract", () => {
      const action: PendingAction = {
        id: "act-123",
        name: "create_dashboard",
        description: "Create new process dashboard",
        arguments: { name: "Sales Log Overview", filter: "none" },
      };
      expect(action.id).toBe("act-123");
      expect(action.name).toBe("create_dashboard");
      expect(action.description).toBe("Create new process dashboard");
      expect(action.arguments.name).toBe("Sales Log Overview");
    });

    it("conforms to TourStep contract", () => {
      const step: TourStep = {
        tour_id: "nav-overview",
        label: "Overview Tab",
      };
      expect(step.tour_id).toBe("nav-overview");
      expect(step.label).toBe("Overview Tab");
    });

    it("conforms to ChatResponse contract", () => {
      const resp: ChatResponse = {
        text: "Here is your response.",
        tool_calls: [{ id: "call-1", name: "get_summary", result: { total: 100 } }],
        pending_actions: [
          {
            id: "pa-1",
            name: "create_dashboard",
            description: "Create dashboard",
            arguments: {},
          },
        ],
        tour_path: [{ tour_id: "nav-playout", label: "Playout" }],
      };
      expect(resp.text).toBe("Here is your response.");
      expect(resp.tool_calls).toHaveLength(1);
      expect(resp.pending_actions).toHaveLength(1);
      expect(resp.tour_path).toHaveLength(1);
    });

    it("conforms to SSEEvent discriminated union types", () => {
      const events: SSEEvent[] = [
        { type: "text", content: "hello world" },
        { type: "tool_call", id: "t1", name: "get_data", arguments: { id: 1 } },
        { type: "tool_result", id: "t1", name: "get_data", result: { success: true } },
        {
          type: "pending_action",
          id: "pa1",
          name: "delete_dashboard",
          description: "Delete item",
          arguments: {},
        },
        { type: "tour_path", steps: [{ tour_id: "nav-1", label: "Step 1" }] },
        { type: "done", usage: { prompt_tokens: 50, completion_tokens: 20 } },
        { type: "error", error: "Something went wrong" },
      ];

      expect(events).toHaveLength(7);
      const types = events.map((e) => e.type);
      expect(types).toEqual([
        "text",
        "tool_call",
        "tool_result",
        "pending_action",
        "tour_path",
        "done",
        "error",
      ]);
    });
  });

  describe("streamChat SSE parser & stream handling", () => {
    function createMockStream(chunks: (string | Uint8Array)[]) {
      const encoder = new TextEncoder();
      let index = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index < chunks.length) {
            const item = chunks[index];
            controller.enqueue(typeof item === "string" ? encoder.encode(item) : item);
            index++;
          } else {
            controller.close();
          }
        },
      });
    }

    it("should parse SSE token stream and complete with done event", async () => {
      const ssePayload = [
        'data: {"type": "text", "content": "Hello "}\n\n',
        'data: {"type": "text", "content": "there!"}\n\n',
        'data: {"type": "done", "usage": {}}\n\n',
      ];

      const mockResponse = new Response(createMockStream(ssePayload), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const events: SSEEvent[] = [];
      for await (const evt of streamChat("Hi", {})) {
        events.push(evt);
      }

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ type: "text", content: "Hello " });
      expect(events[1]).toEqual({ type: "text", content: "there!" });
      expect(events[2]).toEqual({ type: "done", usage: {} });
    });

    it("should handle fragmented chunks split across multiple read() cycles", async () => {
      const fragmentedChunks = [
        'data: {"type": "text", "con',
        'tent": "Frag',
        'mented text"}\n\n',
        'data: {"type": "done"',
        ', "usage": {}}\n\n',
      ];

      const mockResponse = new Response(createMockStream(fragmentedChunks), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const events: SSEEvent[] = [];
      for await (const evt of streamChat("Hi", {})) {
        events.push(evt);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "text", content: "Fragmented text" });
      expect(events[1]).toEqual({ type: "done", usage: {} });
    });

    it("should handle multi-byte UTF-8 characters split across byte boundaries", async () => {
      // 🚀 is 4 bytes: [0xF0, 0x9F, 0x98, 0x80]
      const fullText = 'data: {"type": "text", "content": "Process Mining 📊 & Rocket 🚀"}\n\n';
      const encoded = new TextEncoder().encode(fullText);

      // Split right inside the UTF-8 multibyte sequence
      const splitPoint = 40;
      const part1 = encoded.slice(0, splitPoint);
      const part2 = encoded.slice(splitPoint);

      const mockResponse = new Response(createMockStream([part1, part2]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const events: SSEEvent[] = [];
      for await (const evt of streamChat("Unicode test", {})) {
        events.push(evt);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "text",
        content: "Process Mining 📊 & Rocket 🚀",
      });
    });

    it("should parse tool_result, pending_action and tour_path events", async () => {
      const ssePayload = [
        'data: {"type": "tool_result", "id": "tr-1", "name": "get_log_summary", "result": {"events": 500}}\n\n',
        'data: {"type": "pending_action", "id": "pa-1", "name": "create_dashboard", "description": "Create dash", "arguments": {"name": "Test"}}\n\n',
        'data: {"type": "tour_path", "steps": [{"tour_id": "nav-dashboard", "label": "Dashboard"}]}\n\n',
        'data: {"type": "done", "usage": {}}\n\n',
      ];

      const mockResponse = new Response(createMockStream(ssePayload), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const events: SSEEvent[] = [];
      for await (const evt of streamChat("Run tools", {})) {
        events.push(evt);
      }

      expect(events).toHaveLength(4);
      expect(events[0].type).toBe("tool_result");
      expect(events[1].type).toBe("pending_action");
      expect(events[2].type).toBe("tour_path");
      expect(events[3].type).toBe("done");
    });

    it("should handle error event from SSE stream and terminate immediately", async () => {
      const ssePayload = [
        'data: {"type": "text", "content": "Starting..."}\n\n',
        'data: {"type": "error", "error": "LLM rate limit reached"}\n\n',
        'data: {"type": "text", "content": "Should not be read"}\n\n',
      ];

      const mockResponse = new Response(createMockStream(ssePayload), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const events: SSEEvent[] = [];
      for await (const evt of streamChat("Test error", {})) {
        events.push(evt);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "text", content: "Starting..." });
      expect(events[1]).toEqual({ type: "error", error: "LLM rate limit reached" });
    });

    it("should gracefully handle malformed JSON lines in SSE stream", async () => {
      const ssePayload = [
        'data: {INVALID_JSON}\n\n',
        'data: {"type": "text", "content": "Recovered valid frame"}\n\n',
        'data: \n\n',
        'data: {"type": "done", "usage": {}}\n\n',
      ];

      const mockResponse = new Response(createMockStream(ssePayload), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const events: SSEEvent[] = [];
      for await (const evt of streamChat("Test malformed", {})) {
        events.push(evt);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "text", content: "Recovered valid frame" });
      expect(events[1]).toEqual({ type: "done", usage: {} });
    });

    it("should handle non-200 HTTP error responses from server", async () => {
      const mockResponse = new Response("Bad Request: missing message", {
        status: 400,
        headers: { "Content-Type": "text/plain" },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const events: SSEEvent[] = [];
      for await (const evt of streamChat("", {})) {
        events.push(evt);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "error",
        error: "HTTP 400: Bad Request: missing message",
      });
    });

    it("should include Bearer token header if present in localStorage", async () => {
      mockLocalStorage.setItem("access_token", "jwt-secret-token-abc");

      const mockResponse = new Response(
        createMockStream(['data: {"type": "done", "usage": {}}\n\n']),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const events: SSEEvent[] = [];
      for await (const evt of streamChat("Auth message", {})) {
        events.push(evt);
      }

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/assistant/chat/"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer jwt-secret-token-abc",
          }),
        })
      );
      expect(events).toHaveLength(1);
    });

    it("should fall back to JSON response when server does not return text/event-stream", async () => {
      const jsonResponseData: ChatResponse = {
        text: "Non-streaming JSON response",
        tool_calls: [{ id: "tc-1", name: "tool", result: { ok: true } }],
        pending_actions: [
          {
            id: "pa-99",
            name: "set_view_mode",
            description: "Switch view",
            arguments: { mode: "conformance" },
          },
        ],
        tour_path: [{ tour_id: "nav-conformance", label: "Conformance" }],
      };

      const mockResponse = new Response(JSON.stringify(jsonResponseData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

      const events: SSEEvent[] = [];
      for await (const evt of streamChat("Help me", {})) {
        events.push(evt);
      }

      expect(events).toHaveLength(5);
      expect(events[0]).toEqual({ type: "text", content: "Non-streaming JSON response" });
      expect(events[1]).toEqual({
        type: "tool_result",
        id: "tc-1",
        name: "tool",
        result: { ok: true },
      });
      expect(events[2]).toEqual({
        type: "pending_action",
        id: "pa-99",
        name: "set_view_mode",
        description: "Switch view",
        arguments: { mode: "conformance" },
      });
      expect(events[3]).toEqual({
        type: "tour_path",
        steps: [{ tour_id: "nav-conformance", label: "Conformance" }],
      });
      expect(events[4]).toEqual({ type: "done", usage: {} });
    });
  });

  describe("sendChat and confirmAction REST calls", () => {
    it("should call POST /api/assistant/chat/ via axios in sendChat", async () => {
      const mockResult: ChatResponse = {
        text: "Response",
        tool_calls: [],
        pending_actions: [],
        tour_path: null,
      };

      vi.mocked(axios.post).mockResolvedValueOnce({ data: mockResult });

      const res = await sendChat("Query", { selected_file_id: 1 });
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/api/assistant/chat/"),
        { message: "Query", context: { selected_file_id: 1 } },
        { headers: { Accept: "application/json" } }
      );
      expect(res).toEqual(mockResult);
    });

    it("should call POST /api/assistant/confirm/ via axios in confirmAction", async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { status: "executed" } });

      const res = await confirmAction("action-456", true);
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/api/assistant/confirm/"),
        { pending_action_id: "action-456", approved: true }
      );
      expect(res).toEqual({ status: "executed" });
    });
  });
});
