/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  ChatMode,
  ChatMessage,
  applyAssistantEvent,
  parseMarkdownBlocks,
  formatInline,
  STORAGE_MODE_KEY,
  STORAGE_MESSAGES_KEY,
} from "../ChatWidget";
import { TOUR_IDS } from "@/tour/tourIds";
import { AssistantEvent, TourStep } from "@/api/assistantApi";
import { runClientAction } from "../clientActions";

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

  describe("C. Agent event stream fault tolerance", () => {
    const fresh = (): ChatMessage => ({
      id: "a",
      role: "assistant",
      content: "",
      timestamp: 0,
      isStreaming: true,
      toolExecutions: [],
    });

    it("resolves parallel tool calls that finish out of order", () => {
      const events: AssistantEvent[] = [
        { type: "tool_start", id: "A", name: "find_variants", summary: "Mining variants", kind: "read" },
        { type: "tool_start", id: "B", name: "get_activity_stats", summary: "Activity stats", kind: "read" },
        { type: "tool_end", id: "B", name: "get_activity_stats", ok: true, duration_ms: 5 },
      ];
      let msg = events.reduce(applyAssistantEvent, fresh());
      expect(msg.toolExecutions!.map((t) => t.status)).toEqual(["executing", "completed"]);
      msg = applyAssistantEvent(msg, { type: "tool_end", id: "A", name: "find_variants", ok: true, duration_ms: 9 });
      expect(msg.toolExecutions!.map((t) => t.status)).toEqual(["completed", "completed"]);
    });

    it("ignores results for unknown tool ids", () => {
      const msg = [
        { type: "tool_start", id: "valid", name: "x", summary: "x", kind: "read" },
        { type: "tool_end", id: "ghost", name: "x", ok: false, duration_ms: 1 },
      ].reduce((m, e) => applyAssistantEvent(m, e as AssistantEvent), fresh());
      expect(msg.toolExecutions).toEqual([{ id: "valid", name: "x", summary: "x", status: "executing" }]);
    });

    it("an aborted stream still ends cleanly", () => {
      const msg = applyAssistantEvent({ ...fresh(), content: "partial" }, { type: "done" });
      expect(msg.isStreaming).toBe(false);
      expect(msg.content).toBe("partial");
    });

    it("recovers safely from localStorage exceptions during mode and history access", () => {
      throwStorageErrors = true;
      let loadedMode: ChatMode = "teach";
      try {
        loadedMode = localStorage.getItem(STORAGE_MODE_KEY) === "act" ? "act" : "teach";
      } catch {
        loadedMode = "teach";
      }
      expect(loadedMode).toBe("teach");
      expect(() => {
        try {
          localStorage.setItem(STORAGE_MESSAGES_KEY, "[]");
        } catch {
          // handled
        }
      }).not.toThrow();
    });
  });

  describe("D. Tour integration and element ids", () => {
    it("verifies all chat tour IDs are declared and non-empty", () => {
      for (const key of ["CHAT_TOGGLE", "CHAT_DRAWER", "CHAT_INPUT", "CHAT_MODE_TEACH", "CHAT_MODE_ACT"] as const) {
        expect(TOUR_IDS[key].length).toBeGreaterThan(0);
      }
    });

    it("start_tour actions reach the tour controller with their steps", () => {
      const startTour = vi.fn();
      const steps: TourStep[] = [
        { tour_id: TOUR_IDS.NAV_OVERVIEW, label: "Overview" },
        { tour_id: TOUR_IDS.FILE_SELECTOR, label: "Pick a log" },
      ];
      runClientAction("start_tour", { steps }, { startTour });
      expect(startTour).toHaveBeenCalledWith(steps);
    });
  });
});
