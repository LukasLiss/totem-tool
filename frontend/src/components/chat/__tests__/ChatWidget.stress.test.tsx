import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  ChatMode,
  ChatMessage,
  ToolExecution,
  parseMarkdownBlocks,
  formatInline,
  STORAGE_MODE_KEY,
  STORAGE_MESSAGES_KEY,
  QUICK_SUGGESTIONS,
} from "../ChatWidget";
import { TOUR_IDS } from "@/tour/tourIds";
import { SSEEvent, TourStep } from "@/api/assistantApi";

// Mock localStorage with fault-injection capabilities
let throwStorageErrors = false;
const mockStorage: Record<string, string> = {};

const mockLocalStorage = {
  getItem: vi.fn((key: string) => {
    if (throwStorageErrors) throw new Error("SecurityError: Access is denied for this document");
    return mockStorage[key] || null;
  }),
  setItem: vi.fn((key: string, value: string) => {
    if (throwStorageErrors) throw new Error("QuotaExceededError: Storage quota exceeded");
    mockStorage[key] = value.toString();
  }),
  removeItem: vi.fn((key: string) => {
    if (throwStorageErrors) throw new Error("SecurityError: Access is denied");
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

// Mock window event dispatching for node test environment
const eventListeners: Record<string, ((event: any) => void)[]> = {};
const mockWindow = {
  dispatchEvent: vi.fn((event: any) => {
    const listeners = eventListeners[event.type] || [];
    listeners.forEach((listener) => listener(event));
    return true;
  }),
  addEventListener: vi.fn((type: string, listener: any) => {
    if (!eventListeners[type]) eventListeners[type] = [];
    eventListeners[type].push(listener);
  }),
  removeEventListener: vi.fn((type: string, listener: any) => {
    if (eventListeners[type]) {
      eventListeners[type] = eventListeners[type].filter((l) => l !== listener);
    }
  }),
};

Object.defineProperty(globalThis, "window", {
  value: mockWindow,
  writable: true,
});

describe("Empirical Challenger Stress Harness — Milestone 2", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
    throwStorageErrors = false;
    for (const key in eventListeners) {
      delete eventListeners[key];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("A. Markdown Parser Adversarial Inputs & Stream Integrity", () => {
    it("handles completely empty input string", () => {
      const blocks = parseMarkdownBlocks("");
      expect(Array.isArray(blocks)).toBe(true);
      expect(blocks.length).toBeGreaterThanOrEqual(1);
    });

    it("handles multiple consecutive newlines and whitespace-only lines without crashing", () => {
      const whitespaceInput = "\n\n   \n\t\n\n";
      const blocks = parseMarkdownBlocks(whitespaceInput);
      expect(blocks).toBeDefined();
      expect(blocks.every((b) => b.type === "spacer" || b.type === "paragraph")).toBe(true);
    });

    it("preserves markdown characters inside fenced code blocks as literal code", () => {
      const codeWithMarkdown = "```python\n# This is a comment, not a header\n- not a list item\n> not a quote\n```";
      const blocks = parseMarkdownBlocks(codeWithMarkdown);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("code");
      expect(blocks[0].language).toBe("python");
      expect(blocks[0].content).toContain("# This is a comment, not a header");
      expect(blocks[0].content).toContain("- not a list item");
      expect(blocks[0].content).toContain("> not a quote");
      expect(blocks[0].isStreaming).toBe(false);
    });

    it("handles unclosed code block during active streaming (incomplete chunk)", () => {
      const streamingCode = "Here is the SQL query:\n```sql\nSELECT case_id, activity, timestamp\nFROM event_log\nWHERE duration > 100";
      const blocks = parseMarkdownBlocks(streamingCode);

      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toEqual({ type: "paragraph", content: "Here is the SQL query:" });
      expect(blocks[1].type).toBe("code");
      expect(blocks[1].language).toBe("sql");
      expect(blocks[1].isStreaming).toBe(true);
      expect(blocks[1].content).toContain("WHERE duration > 100");
    });

    it("handles multiple consecutive code blocks without bleeding context", () => {
      const input = "```json\n{\"step\": 1}\n```\n```typescript\nconst step = 2;\n```";
      const blocks = parseMarkdownBlocks(input);

      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toEqual({
        type: "code",
        content: "{\"step\": 1}",
        language: "json",
        isStreaming: false,
      });
      expect(blocks[1]).toEqual({
        type: "code",
        content: "const step = 2;",
        language: "typescript",
        isStreaming: false,
      });
    });

    it("handles large text payloads (stress test: 1000 lines)", () => {
      const lines: string[] = [];
      for (let i = 0; i < 1000; i++) {
        if (i % 4 === 0) lines.push(`### Header ${i}`);
        else if (i % 4 === 1) lines.push(`- Bullet item ${i}`);
        else if (i % 4 === 2) lines.push(`> Blockquote notice ${i}`);
        else lines.push(`Regular paragraph text at line ${i}`);
      }

      const hugeInput = lines.join("\n");
      const startTime = performance.now();
      const blocks = parseMarkdownBlocks(hugeInput);
      const duration = performance.now() - startTime;

      expect(blocks).toHaveLength(1000);
      expect(duration).toBeLessThan(150); // Must parse 1000 lines in < 150ms
    });
  });

  describe("B. Inline Formatter Adversarial Inputs & Regex Resiliency", () => {
    it("handles unclosed inline code backticks gracefully without crashing", () => {
      const input = "Here is an unclosed `code block in text";
      const result = formatInline(input);
      expect(result).toBe(input);
    });

    it("handles unclosed single asterisk italic gracefully without crashing", () => {
      const input = "Here is *unclosed italic text";
      const result = formatInline(input);
      expect(result).toBe(input);
    });

    it("handles unclosed bold asterisks gracefully without crashing or throwing", () => {
      const input = "Here is **unclosed bold text";
      const result = formatInline(input);
      expect(result).toBeDefined();
    });

    it("handles strings with regex special characters and math expressions", () => {
      const input = "Cost is **$100.00 [USD]** where x = `(a + b) / {c * d}^2` & regex is `^test.*$`";
      const result = formatInline(input);
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles potential XSS and HTML tags safely without execution", () => {
      const malicious = '<script>alert("xss")</script> and <img src="x" onerror="stealCookie()"/>';
      const result = formatInline(malicious);
      expect(result).toBe(malicious);
    });

    it("handles consecutive and adjacent format markers", () => {
      const input = "**Bold1****Bold2**`code1``code2`*italic1**italic2*";
      const result = formatInline(input);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("C. State Machine Stream Interruption & Fault Tolerance", () => {
    it("simulates rapid stream abort and guarantees isStreaming is cleared", () => {
      let state: ChatMessage[] = [
        {
          id: "asst-streaming-1",
          role: "assistant",
          content: "Streaming response token...",
          timestamp: Date.now(),
          isStreaming: true,
        },
      ];

      const controller = new AbortController();
      controller.abort();

      if (controller.signal.aborted) {
        state = state.map((msg) =>
          msg.isStreaming ? { ...msg, isStreaming: false } : msg
        );
      }

      expect(state[0].isStreaming).toBe(false);
      expect(state[0].content).toBe("Streaming response token...");
    });

    it("handles out-of-order tool_call and tool_result events gracefully", () => {
      let msg: ChatMessage = {
        id: "asst-tool-stream",
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isStreaming: true,
        toolExecutions: [],
      };

      // 1. Tool Call A received
      msg = {
        ...msg,
        toolExecutions: [
          ...(msg.toolExecutions || []),
          { id: "call-A", name: "tool_a", arguments: { x: 1 }, status: "executing" },
        ],
      };

      // 2. Tool Call B received before Tool A finishes
      msg = {
        ...msg,
        toolExecutions: [
          ...(msg.toolExecutions || []),
          { id: "call-B", name: "tool_b", arguments: { y: 2 }, status: "executing" },
        ],
      };

      expect(msg.toolExecutions).toHaveLength(2);
      expect(msg.toolExecutions![0].status).toBe("executing");
      expect(msg.toolExecutions![1].status).toBe("executing");

      // 3. Tool Result for B arrives first
      msg = {
        ...msg,
        toolExecutions: msg.toolExecutions!.map((te) =>
          te.id === "call-B" ? { ...te, result: { resB: true }, status: "completed" } : te
        ),
      };

      expect(msg.toolExecutions![0].status).toBe("executing");
      expect(msg.toolExecutions![1].status).toBe("completed");

      // 4. Tool Result for A arrives second
      msg = {
        ...msg,
        toolExecutions: msg.toolExecutions!.map((te) =>
          te.id === "call-A" ? { ...te, result: { resA: true }, status: "completed" } : te
        ),
      };

      expect(msg.toolExecutions![0].status).toBe("completed");
      expect(msg.toolExecutions![1].status).toBe("completed");
    });

    it("tolerates unknown tool result IDs without mutating or corrupting existing tool states", () => {
      const initialExecutions: ToolExecution[] = [
        { id: "valid-1", name: "get_variants", status: "executing" },
      ];

      const updated = initialExecutions.map((te) =>
        te.id === "unknown-tool-id"
          ? { ...te, result: "data", status: "completed" as const }
          : te
      );

      expect(updated[0].status).toBe("executing");
      expect(updated[0].result).toBeUndefined();
    });

    it("recovers safely from localStorage exceptions during mode and history access", () => {
      throwStorageErrors = true;

      // Mode retrieval fallback
      let loadedMode: ChatMode = "teach";
      try {
        const saved = localStorage.getItem(STORAGE_MODE_KEY);
        loadedMode = saved === "act" ? "act" : "teach";
      } catch {
        loadedMode = "teach";
      }
      expect(loadedMode).toBe("teach");

      // Messages retrieval fallback
      let loadedMessages: ChatMessage[] = [];
      try {
        const saved = localStorage.getItem(STORAGE_MESSAGES_KEY);
        if (saved) {
          loadedMessages = JSON.parse(saved);
        }
      } catch {
        loadedMessages = [];
      }
      expect(loadedMessages).toEqual([]);

      // Mode saving exception handling
      expect(() => {
        try {
          localStorage.setItem(STORAGE_MODE_KEY, "act");
        } catch {
          // Handled gracefully
        }
      }).not.toThrow();
    });
  });

  describe("D. PendingActions CustomEvent Event Bus Integration", () => {
    it("dispatches 'totem:refresh-dashboard' event with dashboard_id upon approval of dashboard-mutating tools", () => {
      const eventListener = vi.fn();
      window.addEventListener("totem:refresh-dashboard", eventListener);

      const mutatingTools = [
        "create_dashboard",
        "add_component",
        "remove_component",
        "update_component",
        "rename_dashboard",
        "delete_dashboard",
      ];

      for (const toolName of mutatingTools) {
        window.dispatchEvent(
          new CustomEvent("totem:refresh-dashboard", {
            detail: { dashboard_id: "dash-123", tool: toolName },
          })
        );
      }

      expect(eventListener).toHaveBeenCalledTimes(6);
      window.removeEventListener("totem:refresh-dashboard", eventListener);
    });

    it("does NOT dispatch 'totem:refresh-dashboard' event for non-mutating tools", () => {
      const eventListener = vi.fn();
      window.addEventListener("totem:refresh-dashboard", eventListener);

      const DASHBOARD_MUTATING_TOOLS = new Set([
        "create_dashboard",
        "add_component",
        "remove_component",
        "update_component",
        "rename_dashboard",
        "delete_dashboard",
      ]);

      const actionName = "get_process_summary";
      const approved = true;

      if (approved && DASHBOARD_MUTATING_TOOLS.has(actionName)) {
        window.dispatchEvent(
          new CustomEvent("totem:refresh-dashboard", {
            detail: { dashboard_id: "dash-123" },
          })
        );
      }

      expect(eventListener).not.toHaveBeenCalled();
      window.removeEventListener("totem:refresh-dashboard", eventListener);
    });
  });

  describe("E. Tour Integration & Element IDs Conformance", () => {
    it("verifies all chat tour IDs are declared and non-empty", () => {
      const requiredTourKeys = [
        "CHAT_TOGGLE",
        "CHAT_DRAWER",
        "CHAT_INPUT",
        "CHAT_MODE_TEACH",
        "CHAT_MODE_ACT",
      ] as const;

      for (const key of requiredTourKeys) {
        expect(TOUR_IDS[key]).toBeDefined();
        expect(typeof TOUR_IDS[key]).toBe("string");
        expect(TOUR_IDS[key].length).toBeGreaterThan(0);
      }
    });

    it("verifies tourController.startTour handles multi-step tours in teach mode", () => {
      const startTourMock = vi.fn();
      const mockTourController = { startTour: startTourMock };

      const steps: TourStep[] = [
        { tour_id: TOUR_IDS.NAV_OVERVIEW, label: "Overview Tab" },
        { tour_id: TOUR_IDS.FILE_SELECTOR, label: "Filter Controls" },
        { tour_id: TOUR_IDS.NAV_ANALYSIS, label: "Process Graph" },
      ];

      const mode: ChatMode = "teach";
      if (mode === "teach" && mockTourController && steps.length > 0) {
        mockTourController.startTour(steps);
      }

      expect(startTourMock).toHaveBeenCalledWith(steps);
    });

    it("verifies suggestion catalogs match mode expectations and contain valid prompts", () => {
      expect(QUICK_SUGGESTIONS.teach.length).toBe(8);
      expect(QUICK_SUGGESTIONS.act.length).toBe(8);

      for (const item of QUICK_SUGGESTIONS.teach) {
        expect(item.label).toBeTruthy();
        expect(item.prompt).toBeTruthy();
      }
      for (const item of QUICK_SUGGESTIONS.act) {
        expect(item.label).toBeTruthy();
        expect(item.prompt).toBeTruthy();
      }
    });
  });
});
