import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  AgentStatusIndicator,
  getOrCreateSessionId,
  resolveWebSocketUrl,
  STORAGE_SESSION_ID_KEY,
  BACKOFF_INTERVALS,
  MAX_RECONNECT_ATTEMPTS,
  ConnectionStatus,
} from "../AgentBridge";
import { executeCommand, AgentCommand } from "../handlers";

// Mock localStorage & sessionStorage
const mockSessionStorageData: Record<string, string> = {};
const mockLocalStorageData: Record<string, string> = {};

const mockSessionStorage = {
  getItem: vi.fn((key: string) => mockSessionStorageData[key] || null),
  setItem: vi.fn((key: string, val: string) => {
    mockSessionStorageData[key] = val.toString();
  }),
  removeItem: vi.fn((key: string) => {
    delete mockSessionStorageData[key];
  }),
  clear: vi.fn(() => {
    for (const k in mockSessionStorageData) delete mockSessionStorageData[k];
  }),
};

const mockLocalStorage = {
  getItem: vi.fn((key: string) => mockLocalStorageData[key] || null),
  setItem: vi.fn((key: string, val: string) => {
    mockLocalStorageData[key] = val.toString();
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorageData[key];
  }),
  clear: vi.fn(() => {
    for (const k in mockLocalStorageData) delete mockLocalStorageData[k];
  }),
};

// Mock Document and Window
const mockDocument = {
  querySelector: vi.fn((selector: string) => null),
  createElement: vi.fn(),
  body: { appendChild: vi.fn() },
};

const mockWindow = {
  location: { pathname: "/overview" },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(() => true),
};

Object.defineProperty(globalThis, "sessionStorage", {
  value: mockSessionStorage,
  writable: true,
});
Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});
Object.defineProperty(globalThis, "document", {
  value: mockDocument,
  writable: true,
});
Object.defineProperty(globalThis, "window", {
  value: mockWindow,
  writable: true,
});

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState: number = 0; // CONNECTING
  sentMessages: string[] = [];
  onopen: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = 1; // OPEN
    this.onopen?.({ type: "open" });
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code = 1000, reason = "") {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code, reason, wasClean: code === 1000 });
  }

  simulateServerMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("AgentBridge contracts, WebSocket lifecycle, and status indicator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSessionStorage.clear();
    mockLocalStorage.clear();
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. getOrCreateSessionId contract", () => {
    it("returns custom session ID if explicitly passed", () => {
      const id = getOrCreateSessionId("sess_custom_explicit");
      expect(id).toBe("sess_custom_explicit");
    });

    it("generates a new session ID with sess_ prefix and stores in sessionStorage", () => {
      const id = getOrCreateSessionId();
      expect(id.startsWith("sess_")).toBe(true);
      expect(mockSessionStorage.setItem).toHaveBeenCalledWith(STORAGE_SESSION_ID_KEY, id);
    });

    it("reuses existing session ID stored in sessionStorage", () => {
      mockSessionStorageData[STORAGE_SESSION_ID_KEY] = "sess_cached_abc123";
      const id = getOrCreateSessionId();
      expect(id).toBe("sess_cached_abc123");
    });
  });

  describe("2. resolveWebSocketUrl contract", () => {
    it("resolves default ws://localhost:8000/ws/agent/ URL with session_id", () => {
      const url = resolveWebSocketUrl(undefined, undefined, "sess_fixed_123");
      expect(url).toContain("ws://localhost:8000/ws/agent/");
      expect(url).toContain("session_id=sess_fixed_123");
    });

    it("includes JWT token when token is passed as argument", () => {
      const url = resolveWebSocketUrl("ws://backend:8000/ws/agent/", "jwt_param_xyz", "sess_fixed_123");
      expect(url).toContain("token=jwt_param_xyz");
      expect(url).toContain("session_id=sess_fixed_123");
    });

    it("extracts token from localStorage when not passed as argument", () => {
      mockLocalStorageData["access_token"] = "jwt_from_local_storage";
      const url = resolveWebSocketUrl("ws://backend:8000/ws/agent/", undefined, "sess_local_1");
      expect(url).toContain("token=jwt_from_local_storage");
    });

    it("ensures trailing slash before query parameters", () => {
      const url = resolveWebSocketUrl("ws://127.0.0.1:8000/ws/agent", undefined, "sess_trail");
      expect(url).toContain("ws://127.0.0.1:8000/ws/agent/?");
    });
  });

  describe("3. AgentStatusIndicator component rendering", () => {
    it("returns correct structure and classes for 'connected' status", () => {
      const element = AgentStatusIndicator({ status: "connected" });
      expect(element).toBeDefined();
      expect(element.props.className).toContain("text-emerald-600");
    });

    it("returns correct structure and classes for 'connecting' status", () => {
      const element = AgentStatusIndicator({ status: "connecting" });
      expect(element).toBeDefined();
      expect(element.props.className).toContain("text-amber-600");
    });

    it("returns correct structure and classes for 'reconnecting' status", () => {
      const element = AgentStatusIndicator({ status: "reconnecting" });
      expect(element).toBeDefined();
      expect(element.props.className).toContain("text-amber-600");
    });

    it("returns correct structure and classes for 'disconnected' status", () => {
      const element = AgentStatusIndicator({ status: "disconnected" });
      expect(element).toBeDefined();
      expect(element.props.className).toContain("text-zinc-400");
    });
  });

  describe("4. Exponential backoff intervals and reconnection constants", () => {
    it("has 5 backoff steps matching specification [1000, 2000, 4000, 8000, 10000]", () => {
      expect(BACKOFF_INTERVALS).toEqual([1000, 2000, 4000, 8000, 10000]);
    });

    it("caps max reconnection attempts at 10", () => {
      expect(MAX_RECONNECT_ATTEMPTS).toBe(10);
    });

    it("calculates exponential backoff progression accurately", () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const delayIndex = Math.min(attempt, BACKOFF_INTERVALS.length - 1);
        const expectedDelay = BACKOFF_INTERVALS[delayIndex];
        expect(expectedDelay).toBeLessThanOrEqual(10000);
        if (attempt === 0) expect(expectedDelay).toBe(1000);
        if (attempt === 1) expect(expectedDelay).toBe(2000);
        if (attempt === 2) expect(expectedDelay).toBe(4000);
        if (attempt === 3) expect(expectedDelay).toBe(8000);
        if (attempt >= 4) expect(expectedDelay).toBe(10000);
      }
    });
  });

  describe("5. Bidirectional live-wire command dispatch & roundtrip execution", () => {
    it("processes incoming server command and transmits structured acknowledgment", async () => {
      const ws = new MockWebSocket("ws://localhost:8000/ws/agent/?session_id=sess_test");
      ws.open();

      const mockNavigate = vi.fn();
      const deps = { navigate: mockNavigate };

      // Simulate onmessage handling logic
      const handleServerMessage = async (msgData: any) => {
        if (msgData && msgData.action) {
          const result = await executeCommand(msgData, deps);
          ws.send(
            JSON.stringify({
              status: result.status,
              correlation_id: msgData.correlation_id,
              payload: result.payload || {},
              error: result.error,
            })
          );
        }
      };

      const serverCommand: AgentCommand = {
        action: "navigate",
        parameters: { route: "/variants" },
        correlation_id: "corr-nav-99",
      };

      await handleServerMessage(serverCommand);

      expect(mockNavigate).toHaveBeenCalledWith("/variantsview", { replace: false });
      expect(ws.sentMessages.length).toBe(1);

      const ack = JSON.parse(ws.sentMessages[0]);
      expect(ack.status).toBe("success");
      expect(ack.correlation_id).toBe("corr-nav-99");
      expect(ack.payload.current_route).toBe("/variantsview");
    });

    it("transmits error acknowledgment frame when command execution throws", async () => {
      const ws = new MockWebSocket("ws://localhost:8000/ws/agent/?session_id=sess_test");
      ws.open();

      const handleServerMessage = async (msgData: any) => {
        if (msgData && msgData.action) {
          const result = await executeCommand(msgData);
          ws.send(
            JSON.stringify({
              status: result.status,
              correlation_id: msgData.correlation_id,
              payload: result.payload || {},
              error: result.error,
            })
          );
        }
      };

      const invalidCommand: AgentCommand = {
        action: "click",
        parameters: { tour_id: "unmounted-element-id" },
        correlation_id: "corr-click-fail",
      };

      await handleServerMessage(invalidCommand);

      expect(ws.sentMessages.length).toBe(1);
      const ack = JSON.parse(ws.sentMessages[0]);
      expect(ack.status).toBe("error");
      expect(ack.correlation_id).toBe("corr-click-fail");
      expect(ack.error).toContain("Element not found matching selector/tour_id");
    });

    it("handles UI state aggregation round-trip", async () => {
      const ws = new MockWebSocket("ws://localhost:8000/ws/agent/?session_id=sess_test");
      ws.open();

      const mockDeps = {
        viewMode: { type: "analysis" as const, component: "ocdfg" as const },
        selectedFile: { id: 101, filename: "order_process.xes" },
      };

      const handleServerMessage = async (msgData: any) => {
        if (msgData && msgData.action) {
          const result = await executeCommand(msgData, mockDeps);
          ws.send(
            JSON.stringify({
              status: result.status,
              correlation_id: msgData.correlation_id,
              payload: result.payload || {},
              error: result.error,
            })
          );
        }
      };

      await handleServerMessage({
        action: "get_ui_state",
        correlation_id: "corr-state-42",
      });

      expect(ws.sentMessages.length).toBe(1);
      const ack = JSON.parse(ws.sentMessages[0]);
      expect(ack.status).toBe("success");
      expect(ack.correlation_id).toBe("corr-state-42");
      expect(ack.payload.view_mode).toEqual({ type: "analysis", component: "ocdfg" });
      expect(ack.payload.selected_file).toEqual({ id: 101, filename: "order_process.xes" });
    });
  });
});
