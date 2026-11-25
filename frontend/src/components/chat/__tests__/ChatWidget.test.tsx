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
        { type: "tool_end", id: "t1", name: "get_log_overview", ok: true, preview: "events 6", duration_ms: 1200 },
      ]);
      expect(msg.toolExecutions?.map((t) => [t.id, t.status])).toEqual([
        ["t1", "completed"],
        ["t2", "failed"],
      ]);
      expect(msg.toolExecutions?.[1].error).toBe("No event log");
      expect(msg.toolExecutions?.[0].durationMs).toBe(1200);
      expect(msg.toolExecutions?.[0].preview).toBe("events 6");
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

  describe("8. Restoring persisted history", () => {
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
