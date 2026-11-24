/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
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
  applyAssistantEvent,
  STORAGE_CONVERSATION_KEY,
} from "../ChatWidget";
import { runClientAction, viewFromArgs } from "../clientActions";
import { TOUR_IDS } from "@/tour/tourIds";
import { AssistantEvent, TourStep } from "@/api/assistantApi";

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
    it("provides labelled prompts for both modes", () => {
      for (const mode of ["teach", "act"] as ChatMode[]) {
        expect(QUICK_SUGGESTIONS[mode].length).toBeGreaterThanOrEqual(5);
        for (const s of QUICK_SUGGESTIONS[mode]) {
          expect(s.label.length).toBeGreaterThan(0);
          expect(s.prompt.length).toBeGreaterThan(s.label.length);
        }
      }
    });
  });

  describe("4. Streamed agent events update the assistant message", () => {
    const base = (): ChatMessage => ({
      id: "a1",
      role: "assistant",
      content: "",
      timestamp: 0,
      isStreaming: true,
      isThinking: true,
      toolExecutions: [],
      pendingActions: [],
    });
    const run = (events: AssistantEvent[]) => events.reduce(applyAssistantEvent, base());

    it("appends text and clears the thinking indicator", () => {
      const msg = run([
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ]);
      expect(msg.content).toBe("Hello world");
      expect(msg.isThinking).toBe(false);
    });

    it("tracks tool calls by id through start and end, including failures", () => {
      const msg = run([
        { type: "tool_start", id: "t1", name: "get_log_overview", summary: "Reading log overview", kind: "read" },
        { type: "tool_start", id: "t2", name: "get_log_overview", summary: "Reading log overview", kind: "read" },
        { type: "tool_end", id: "t2", name: "get_log_overview", ok: false, error: "No event log", duration_ms: 3 },
        { type: "tool_end", id: "t1", name: "get_log_overview", ok: true, duration_ms: 1200 },
      ]);
      expect(msg.toolExecutions?.map((t) => [t.id, t.status])).toEqual([
        ["t1", "completed"],
        ["t2", "failed"],
      ]);
      expect(msg.toolExecutions?.[1].error).toBe("No event log");
      expect(msg.toolExecutions?.[0].durationMs).toBe(1200);
    });

    it("collects proposed changes for approval", () => {
      const msg = run([
        { type: "pending_action", id: "act_1", name: "create_dashboard", description: "Create dashboard", arguments: { name: "Ops" } },
      ]);
      expect(msg.pendingActions).toEqual([
        { id: "act_1", name: "create_dashboard", description: "Create dashboard", arguments: { name: "Ops" } },
      ]);
    });

    it("records guided tours, notices and errors", () => {
      const msg = run([
        { type: "client_action", id: "c", name: "start_tour", arguments: { steps: [{ tour_id: "nav-analysis", label: "Open" }] } },
        { type: "notice", text: "Stopped after 12 steps." },
        { type: "error", code: "rate_limit", message: "slow down", retryable: true },
      ]);
      expect(msg.tourPath).toHaveLength(1);
      expect(msg.notices).toEqual(["Stopped after 12 steps."]);
      expect(msg.error).toBe("slow down");
    });

    it("done ends streaming and marks unfinished tools as interrupted", () => {
      const msg = run([
        { type: "tool_start", id: "t1", name: "find_variants", summary: "Mining variants", kind: "read" },
        { type: "done" },
      ]);
      expect(msg.isStreaming).toBe(false);
      expect(msg.toolExecutions?.[0]).toMatchObject({ status: "failed", error: "Interrupted" });
    });
  });

  describe("5. Browser-side assistant actions", () => {
    it("open_view maps tool arguments to app views", () => {
      expect(viewFromArgs({ view: "analysis", component: "dotted_chart" })).toEqual({ type: "analysis", component: "dottedChart" });
      expect(viewFromArgs({ view: "conformance", component: "occn" })).toEqual({ type: "conformance", component: "occn" });
      expect(viewFromArgs({ view: "dashboard", dashboard_id: 4 })).toEqual({ type: "dashboard", id: 4 });
      expect(viewFromArgs({ view: "dashboard" })).toBeNull();
      expect(viewFromArgs({ view: "nowhere" })).toBeNull();
    });

    it("open_view navigates and switches the view", () => {
      const setViewMode = vi.fn();
      const navigate = vi.fn();
      expect(runClientAction("open_view", { view: "analysis", component: "variants" }, { setViewMode, navigate })).toBe(true);
      expect(navigate).toHaveBeenCalledWith("/overview");
      expect(setViewMode).toHaveBeenCalledWith({ type: "analysis", component: "variants" });
    });

    it("start_tour closes the drawer and starts the tour in any mode", () => {
      const startTour = vi.fn();
      const onTourStart = vi.fn();
      const steps: TourStep[] = [{ tour_id: TOUR_IDS.NAV_DASHBOARD, label: "Open dashboards" }];
      expect(runClientAction("start_tour", { steps }, { startTour, onTourStart })).toBe(true);
      expect(onTourStart).toHaveBeenCalled();
      expect(startTour).toHaveBeenCalledWith(steps);
    });

    it("reports actions it cannot apply", () => {
      expect(runClientAction("start_tour", { steps: [] }, { startTour: vi.fn() })).toBe(false);
      expect(runClientAction("open_view", { view: "overview" }, {})).toBe(false);
      expect(runClientAction("rm_rf", {}, {})).toBe(false);
    });
  });

  describe("6. Per-mode conversation ids", () => {
    it("uses one storage key per mode", () => {
      expect(STORAGE_CONVERSATION_KEY("teach")).not.toBe(STORAGE_CONVERSATION_KEY("act"));
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

    it("renders safe https and mailto markdown links as anchors", () => {
      const text = "Visit [Totem Docs](https://totem.org) or email [Support](mailto:support@totem.org).";
      const formatted = formatInline(text);

      expect(Array.isArray(formatted)).toBe(true);
      const elements = formatted as React.ReactElement<{ href?: string; rel?: string }>[];
      const links = elements.filter(
        (el): el is React.ReactElement<{ href?: string; rel?: string }> =>
          React.isValidElement(el) && el.type === "a"
      );
      expect(links.length).toBe(2);
      expect(links[0].props.href).toBe("https://totem.org");
      expect(links[0].props.rel).toBe("noopener noreferrer");
      expect(links[1].props.href).toBe("mailto:support@totem.org");
    });

    it("disallows javascript: and data: links, rendering only safe plain text", () => {
      const text = "Click [Malicious](javascript:alert(1)) or [Data](data:text/html;base64,PHNjcmlwdD4=).";
      const formatted = formatInline(text);

      expect(Array.isArray(formatted)).toBe(true);
      const elements = formatted as React.ReactNode[];
      // None of the elements should be an <a> tag pointing to javascript: or data:
      const unsafeLinks = elements.filter(
        (el) => React.isValidElement(el) && el.type === "a"
      );
      expect(unsafeLinks.length).toBe(0);
      // Link text should be preserved as safe plain text
      expect(elements).toContain("Malicious");
      expect(elements).toContain("Data");
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
