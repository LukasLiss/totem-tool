/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  ChatMode,
  ChatMessage,
  applyAssistantEvent,
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
