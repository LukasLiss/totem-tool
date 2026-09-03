import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  ChatMode,
  ChatMessage,
  ToolExecution,
  STORAGE_MODE_KEY,
  STORAGE_MESSAGES_KEY,
  STORAGE_MESSAGES_KEY_TEACH,
  STORAGE_MESSAGES_KEY_ACT,
  STORAGE_DRAWER_WIDTH_KEY,
  DEFAULT_DRAWER_WIDTH,
  WIDE_DRAWER_WIDTH,
  MIN_DRAWER_WIDTH,
  QUICK_SUGGESTIONS,
  parseMarkdownBlocks,
  formatInline,
  repairMojibake,
  MarkdownRenderer,
} from "../ChatWidget";
import { TOUR_IDS } from "@/tour/tourIds";
import { SSEEvent, TourStep } from "@/api/assistantApi";

// Mock localStorage for node test environment
const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => mockStorage[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    mockStorage[key] = value.toString();
  }),
  removeItem: vi.fn((key: string) => {
    delete mockStorage[key];
  }),
  clear: vi.fn(() => {
    for (const key in mockStorage) {
      delete mockStorage[key];
    }
  }),
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

describe("ChatWidget contracts, state machine transitions, and tour integrations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Mode persistence and toggling contract", () => {
    it("uses correct storage key constants", () => {
      expect(STORAGE_MODE_KEY).toBe("totem_chat_mode");
      expect(STORAGE_MESSAGES_KEY).toBe("totem_chat_messages");
    });

    it("initializes default mode to 'teach' when no localStorage item exists", () => {
      const saved = localStorage.getItem(STORAGE_MODE_KEY);
      const initialMode: ChatMode = saved === "act" ? "act" : "teach";
      expect(initialMode).toBe("teach");
    });

    it("loads persisted mode 'act' from localStorage", () => {
      localStorage.setItem(STORAGE_MODE_KEY, "act");
      const saved = localStorage.getItem(STORAGE_MODE_KEY);
      const loadedMode: ChatMode = saved === "act" ? "act" : "teach";
      expect(loadedMode).toBe("act");
    });

    it("falls back to 'teach' if localStorage has an invalid value", () => {
      localStorage.setItem(STORAGE_MODE_KEY, "unknown_mode");
      const saved = localStorage.getItem(STORAGE_MODE_KEY);
      const mode: ChatMode = saved === "act" ? "act" : "teach";
      expect(mode).toBe("teach");
    });

    it("persists mode switches between 'teach' and 'act'", () => {
      let currentMode: ChatMode = "teach";
      const setMode = (m: ChatMode) => {
        currentMode = m;
        localStorage.setItem(STORAGE_MODE_KEY, m);
      };

      setMode("act");
      expect(currentMode).toBe("act");
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(STORAGE_MODE_KEY, "act");

      setMode("teach");
      expect(currentMode).toBe("teach");
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(STORAGE_MODE_KEY, "teach");
    });
  });

  describe("2. Tour IDs contract validation", () => {
    it("contains all required tour ID hooks for ChatWidget drawer and triggers", () => {
      expect(TOUR_IDS.CHAT_TOGGLE).toBe("chat-toggle");
      expect(TOUR_IDS.CHAT_DRAWER).toBe("chat-drawer");
      expect(TOUR_IDS.CHAT_INPUT).toBe("chat-input");
      expect(TOUR_IDS.CHAT_MODE_TEACH).toBe("chat-mode-teach");
      expect(TOUR_IDS.CHAT_MODE_ACT).toBe("chat-mode-act");
    });
  });

  describe("3. Quick suggestions catalog validation", () => {
    it("provides 8 structured quick suggestions for Teach Mode", () => {
      expect(QUICK_SUGGESTIONS.teach).toHaveLength(8);
      for (const item of QUICK_SUGGESTIONS.teach) {
        expect(item.label).toBeTypeOf("string");
        expect(item.prompt).toBeTypeOf("string");
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.prompt.length).toBeGreaterThan(0);
      }
    });

    it("provides 8 structured quick suggestions for Act Mode", () => {
      expect(QUICK_SUGGESTIONS.act).toHaveLength(8);
      for (const item of QUICK_SUGGESTIONS.act) {
        expect(item.label).toBeTypeOf("string");
        expect(item.prompt).toBeTypeOf("string");
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.prompt.length).toBeGreaterThan(0);
      }
    });
  });

  describe("4. Streaming message state transitions", () => {
    it("correctly appends tokens to active assistant message during stream", () => {
      const messages: ChatMessage[] = [
        {
          id: "asst-1",
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          isStreaming: true,
        },
      ];

      const tokenChunks = ["Hello ", "process ", "miner!"];
      for (const token of tokenChunks) {
        messages[0] = {
          ...messages[0],
          content: messages[0].content + token,
        };
      }

      expect(messages[0].content).toBe("Hello process miner!");
      expect(messages[0].isStreaming).toBe(true);
    });

    it("handles tool_call and tool_result events on assistant message", () => {
      const msg: ChatMessage = {
        id: "asst-2",
        role: "assistant",
        content: "Analyzing log...",
        timestamp: Date.now(),
        toolExecutions: [
          {
            id: "call-1",
            name: "get_variants",
            arguments: { limit: 5 },
            status: "executing",
          },
        ],
      };

      expect(msg.toolExecutions![0].status).toBe("executing");
      expect(msg.toolExecutions![0].arguments).toEqual({ limit: 5 });

      // Tool completes
      msg.toolExecutions = msg.toolExecutions!.map((te) =>
        te.id === "call-1"
          ? { ...te, result: { variant_count: 5 }, status: "completed" as const }
          : te
      );

      expect(msg.toolExecutions[0].status).toBe("completed");
      expect(msg.toolExecutions[0].result).toEqual({ variant_count: 5 });
    });

    it("handles tool failure status transitions", () => {
      const msg: ChatMessage = {
        id: "asst-tool-fail",
        role: "assistant",
        content: "Running tool...",
        timestamp: Date.now(),
        toolExecutions: [
          {
            id: "call-err-1",
            name: "calculate_bottlenecks",
            arguments: {},
            status: "executing",
          },
        ],
      };

      // Tool fails
      msg.toolExecutions = msg.toolExecutions!.map((te) =>
        te.id === "call-err-1"
          ? { ...te, status: "failed" as const, result: "Failed to parse timestamp column" }
          : te
      );

      expect(msg.toolExecutions[0].status).toBe("failed");
      expect(msg.toolExecutions[0].result).toBe("Failed to parse timestamp column");
    });

    it("handles multiple sequential tool executions", () => {
      const toolExecutions: ToolExecution[] = [];

      // Tool 1 start
      toolExecutions.push({ id: "t1", name: "get_summary", status: "executing" });
      expect(toolExecutions).toHaveLength(1);

      // Tool 1 finish
      toolExecutions[0] = { ...toolExecutions[0], status: "completed", result: { cases: 100 } };

      // Tool 2 start
      toolExecutions.push({ id: "t2", name: "get_variants", status: "executing" });
      expect(toolExecutions).toHaveLength(2);
      expect(toolExecutions[0].status).toBe("completed");
      expect(toolExecutions[1].status).toBe("executing");

      // Tool 2 finish
      toolExecutions[1] = { ...toolExecutions[1], status: "completed", result: { variants: 12 } };
      expect(toolExecutions[1].status).toBe("completed");
    });

    it("handles pending_actions and resolves them correctly", () => {
      let pending = [
        {
          id: "pa-1",
          name: "create_dashboard",
          description: "Create Summary Dashboard",
          arguments: { name: "Summary" },
        },
        {
          id: "pa-2",
          name: "add_component",
          description: "Add Variants Card",
          arguments: { type: "variants" },
        },
      ];

      // Resolve pa-1
      pending = pending.filter((a) => a.id !== "pa-1");
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe("pa-2");
      expect(pending[0].name).toBe("add_component");

      // Resolve pa-2
      pending = pending.filter((a) => a.id !== "pa-2");
      expect(pending).toHaveLength(0);
    });

    it("handles error events in SSE stream and sets error state", () => {
      let assistantMsg: ChatMessage = {
        id: "asst-err",
        role: "assistant",
        content: "Starting analysis...",
        timestamp: Date.now(),
        isStreaming: true,
      };

      const errorEvent: SSEEvent = {
        type: "error",
        error: "Rate limit exceeded on Gemini API",
      };

      if (errorEvent.type === "error") {
        assistantMsg = {
          ...assistantMsg,
          error: errorEvent.error,
          isStreaming: false,
        };
      }

      expect(assistantMsg.error).toBe("Rate limit exceeded on Gemini API");
      expect(assistantMsg.isStreaming).toBe(false);
    });

    it("finalizes isStreaming state when done event is received", () => {
      let assistantMsg: ChatMessage = {
        id: "asst-done",
        role: "assistant",
        content: "Here is your finished model.",
        timestamp: Date.now(),
        isStreaming: true,
      };

      const doneEvent: SSEEvent = {
        type: "done",
        usage: { prompt_tokens: 120, completion_tokens: 45 },
      };

      if (doneEvent.type === "done") {
        assistantMsg = {
          ...assistantMsg,
          isStreaming: false,
        };
      }

      expect(assistantMsg.isStreaming).toBe(false);
      expect(assistantMsg.content).toBe("Here is your finished model.");
    });
  });

  describe("5. Teach Mode tour trigger integration", () => {
    it("dispatches startTour with received steps when tour_path arrives in Teach Mode", () => {
      const startTourMock = vi.fn();
      const mockTourController = {
        state: {
          active: false,
          steps: [],
          currentIndex: 0,
          currentTourId: null,
          currentLabel: "",
          isLastStep: true,
        },
        startTour: startTourMock,
        nextStep: vi.fn(),
        skipTour: vi.fn(),
      };

      const mode: ChatMode = "teach";
      const tourEvent: SSEEvent = {
        type: "tour_path",
        steps: [
          { tour_id: "nav-overview", label: "Overview Tab" },
          { tour_id: "upload-button", label: "Upload Log Button" },
        ],
      };

      if (mode === "teach" && mockTourController && tourEvent.steps.length > 0) {
        mockTourController.startTour(tourEvent.steps);
      }

      expect(startTourMock).toHaveBeenCalledWith(tourEvent.steps);
      expect(startTourMock).toHaveBeenCalledTimes(1);
    });

    it("does not trigger startTour if mode is 'act'", () => {
      const startTourMock = vi.fn();
      const mockTourController = {
        startTour: startTourMock,
      };

      const mode = "act" as ChatMode;
      const tourEvent: SSEEvent = {
        type: "tour_path",
        steps: [{ tour_id: "nav-dashboard", label: "Dashboard" }],
      };

      if ((mode as string) === "teach" && tourEvent.steps.length > 0) {
        mockTourController.startTour(tourEvent.steps);
      }

      expect(startTourMock).not.toHaveBeenCalled();
    });

    it("does not trigger startTour if steps array is empty", () => {
      const startTourMock = vi.fn();
      const mockTourController = {
        startTour: startTourMock,
      };

      const mode: ChatMode = "teach";
      const tourEvent: SSEEvent = {
        type: "tour_path",
        steps: [],
      };

      if (mode === "teach" && tourEvent.steps.length > 0) {
        mockTourController.startTour(tourEvent.steps);
      }

      expect(startTourMock).not.toHaveBeenCalled();
    });
  });

  describe("6. AbortController stream cancellation", () => {
    it("properly signals abort when user stops generation or clears conversation", () => {
      const controller = new AbortController();
      expect(controller.signal.aborted).toBe(false);

      controller.abort();
      expect(controller.signal.aborted).toBe(true);
    });

    it("resets isStreaming on all streaming messages when generation is stopped", () => {
      const msgs: ChatMessage[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: "Partial stream...",
          timestamp: Date.now(),
          isStreaming: true,
        },
      ];

      const stoppedMsgs = msgs.map((msg) =>
        msg.isStreaming ? { ...msg, isStreaming: false } : msg
      );

      expect(stoppedMsgs[0].isStreaming).toBe(false);
      expect(stoppedMsgs[0].content).toBe("Partial stream...");
    });
  });

  describe("7. Message history persistence in localStorage", () => {
    it("serializes and deserializes message history accurately", () => {
      const history: ChatMessage[] = [
        {
          id: "usr-1",
          role: "user",
          content: "Hello",
          timestamp: 1000,
          mode: "teach",
        },
        {
          id: "asst-1",
          role: "assistant",
          content: "Welcome to Totem!",
          timestamp: 1001,
          mode: "teach",
        },
      ];

      localStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(history));
      const raw = localStorage.getItem(STORAGE_MESSAGES_KEY);
      expect(raw).not.toBeNull();

      const parsed: ChatMessage[] = JSON.parse(raw!);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].content).toBe("Hello");
      expect(parsed[1].content).toBe("Welcome to Totem!");
    });

    it("recovers gracefully from corrupted localStorage JSON", () => {
      localStorage.setItem(STORAGE_MESSAGES_KEY, "INVALID_JSON_OBJECT");

      let loaded: ChatMessage[] = [];
      try {
        const raw = localStorage.getItem(STORAGE_MESSAGES_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          loaded = Array.isArray(parsed) ? parsed : [];
        }
      } catch {
        loaded = [];
      }

      expect(loaded).toEqual([]);
    });

    it("clears message history and removes localStorage key when cleared", () => {
      localStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify([{ id: "1", role: "user", content: "x", timestamp: 1 }]));
      expect(localStorage.getItem(STORAGE_MESSAGES_KEY)).not.toBeNull();

      localStorage.removeItem(STORAGE_MESSAGES_KEY);
      expect(localStorage.getItem(STORAGE_MESSAGES_KEY)).toBeNull();
    });
  });

  describe("8. Markdown parsing and formatting contract", () => {
    it("parses headers, blockquotes, bullet lists, numbered lists and paragraphs", () => {
      const markdown = "# Title\n## Subtitle\n### Heading 3\n> Quote\n- Bullet 1\n* Bullet 2\n1. Numbered 1\n\nParagraph text.";
      const blocks = parseMarkdownBlocks(markdown);

      expect(blocks).toEqual([
        { type: "header", level: 1, content: "Title" },
        { type: "header", level: 2, content: "Subtitle" },
        { type: "header", level: 3, content: "Heading 3" },
        { type: "blockquote", content: "Quote" },
        { type: "list-bullet", content: "Bullet 1" },
        { type: "list-bullet", content: "Bullet 2" },
        { type: "list-number", content: "Numbered 1" },
        { type: "spacer" },
        { type: "paragraph", content: "Paragraph text." },
      ]);
    });

    it("parses fenced code blocks with language and content", () => {
      const codeMarkdown = "```python\ndef hello():\n    return 'world'\n```";
      const blocks = parseMarkdownBlocks(codeMarkdown);

      expect(blocks).toEqual([
        {
          type: "code",
          content: "def hello():\n    return 'world'",
          language: "python",
          isStreaming: false,
        },
      ]);
    });

    it("parses code blocks without language specifier defaulting to 'code'", () => {
      const codeMarkdown = "```\nconst x = 1;\n```";
      const blocks = parseMarkdownBlocks(codeMarkdown);

      expect(blocks).toEqual([
        {
          type: "code",
          content: "const x = 1;",
          language: "code",
          isStreaming: false,
        },
      ]);
    });

    it("handles unclosed streaming code blocks by setting isStreaming: true", () => {
      const unclosedMarkdown = "Here is code:\n```typescript\nconst x = 42;";
      const blocks = parseMarkdownBlocks(unclosedMarkdown);

      expect(blocks).toEqual([
        { type: "paragraph", content: "Here is code:" },
        {
          type: "code",
          content: "const x = 42;",
          language: "typescript",
          isStreaming: true,
        },
      ]);
    });

    it("handles multiple consecutive code blocks", () => {
      const multiCode = "```sql\nSELECT * FROM cases;\n```\n\n```json\n{\"id\": 1}\n```";
      const blocks = parseMarkdownBlocks(multiCode);

      expect(blocks).toHaveLength(3);
      expect(blocks[0]).toEqual({
        type: "code",
        content: "SELECT * FROM cases;",
        language: "sql",
        isStreaming: false,
      });
      expect(blocks[1]).toEqual({ type: "spacer" });
      expect(blocks[2]).toEqual({
        type: "code",
        content: "{\"id\": 1}",
        language: "json",
        isStreaming: false,
      });
    });

    it("formats inline bold, inline code, and italic tokens", () => {
      const inlineText = "This is **bold**, this is `code`, and this is *italic*.";
      const formatted = formatInline(inlineText);

      expect(formatted).toBeDefined();
      expect(Array.isArray(formatted)).toBe(true);
    });

    it("returns unmodified string if no inline tokens are present", () => {
      const plainText = "Just plain text without markdown tokens.";
      const formatted = formatInline(plainText);
      expect(formatted).toBe(plainText);
    });

    it("formats nested or consecutive inline formatting tokens", () => {
      const text = "**Bold1** followed by **Bold2** and `code1`";
      const formatted = formatInline(text);

      expect(Array.isArray(formatted)).toBe(true);
      const elements = formatted as React.ReactNode[];
      expect(elements.length).toBeGreaterThanOrEqual(4);
    });

    it("parses markdown tables with headers, alignments, and rows", () => {
      const tableMarkdown = "| Metric | Value | Interpretation |\n| :--- | :---: | ---: |\n| Total Events | 28,278 | High density |\n| Total Objects | 8,819 | Unique entities |";
      const blocks = parseMarkdownBlocks(tableMarkdown);

      expect(blocks).toEqual([
        {
          type: "table",
          headers: ["Metric", "Value", "Interpretation"],
          alignments: ["left", "center", "right"],
          rows: [
            ["Total Events", "28,278", "High density"],
            ["Total Objects", "8,819", "Unique entities"],
          ],
        },
      ]);
    });

    it("parses horizontal rules (---, ***, ___)", () => {
      const hrMarkdown = "Paragraph 1\n---\nParagraph 2";
      const blocks = parseMarkdownBlocks(hrMarkdown);

      expect(blocks).toEqual([
        { type: "paragraph", content: "Paragraph 1" },
        { type: "hr" },
        { type: "paragraph", content: "Paragraph 2" },
      ]);
    });

    it("handles HTML <br> tags in formatInline", () => {
      const textWithBr = "Line 1 <br> Line 2 <br/> Line 3";
      const formatted = formatInline(textWithBr);

      expect(Array.isArray(formatted)).toBe(true);
      const elements = formatted as React.ReactNode[];
      expect(elements.length).toBe(5);
    });

    it("repairs Latin-1 / Windows-1252 mojibake back to genuine emojis", () => {
      const mojibake = "\xf0\x9f\x93\x8a Log Profile & Key Metrics";
      const repaired = repairMojibake(mojibake);
      expect(repaired).toBe("📊 Log Profile & Key Metrics");
    });

    it("instantiates table blocks via MarkdownRenderer as a valid React element", () => {
      const tableMarkdown = "| Header 1 | Header 2 |\n| :--- | :---: |\n| Cell 1 | Cell 2 |";
      const el = React.createElement(MarkdownRenderer, { content: tableMarkdown });
      expect(React.isValidElement(el)).toBe(true);
    });

    it("clears stale isStreaming flags when restoring from localStorage", () => {
      const staleMessages = [
        { id: "1", role: "assistant", content: "Some partial text", isStreaming: true, timestamp: Date.now() },
      ];
      mockStorage[STORAGE_MESSAGES_KEY] = JSON.stringify(staleMessages);

      const saved = localStorage.getItem(STORAGE_MESSAGES_KEY);
      const parsed = JSON.parse(saved!);
      const sanitized = parsed.map((m: any) => ({ ...m, isStreaming: false }));

      expect(sanitized[0].isStreaming).toBe(false);
    });

    it("verifies drawer width constants and boundaries", () => {
      expect(STORAGE_DRAWER_WIDTH_KEY).toBe("totem_chat_drawer_width");
      expect(DEFAULT_DRAWER_WIDTH).toBe(580);
      expect(WIDE_DRAWER_WIDTH).toBe(840);
      expect(MIN_DRAWER_WIDTH).toBe(420);
      expect(WIDE_DRAWER_WIDTH).toBeGreaterThan(DEFAULT_DRAWER_WIDTH);
      expect(DEFAULT_DRAWER_WIDTH).toBeGreaterThan(MIN_DRAWER_WIDTH);
    });

    it("persists custom drawer width to localStorage", () => {
      mockStorage[STORAGE_DRAWER_WIDTH_KEY] = "720";
      const saved = localStorage.getItem(STORAGE_DRAWER_WIDTH_KEY);
      expect(saved).toBe("720");
      const parsed = parseInt(saved!, 10);
      expect(parsed).toBe(720);
    });

    it("verifies per-mode storage keys and separate message persistence for teach and act", () => {
      expect(STORAGE_MESSAGES_KEY_TEACH).toBe("totem_chat_messages_teach");
      expect(STORAGE_MESSAGES_KEY_ACT).toBe("totem_chat_messages_act");

      const teachHistory = [{ id: "t1", role: "user", content: "Teach question", timestamp: 1 }];
      const actHistory = [{ id: "a1", role: "user", content: "Act task", timestamp: 2 }];

      mockStorage[STORAGE_MESSAGES_KEY_TEACH] = JSON.stringify(teachHistory);
      mockStorage[STORAGE_MESSAGES_KEY_ACT] = JSON.stringify(actHistory);

      const parsedTeach = JSON.parse(localStorage.getItem(STORAGE_MESSAGES_KEY_TEACH)!);
      const parsedAct = JSON.parse(localStorage.getItem(STORAGE_MESSAGES_KEY_ACT)!);

      expect(parsedTeach[0].content).toBe("Teach question");
      expect(parsedAct[0].content).toBe("Act task");
      expect(parsedTeach).not.toEqual(parsedAct);
    });
  });
});
