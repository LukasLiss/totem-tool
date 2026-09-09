import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  executeCommand,
  resolveViewMode,
  normalizeRoute,
  AgentCommand,
  HandlerDependencies,
} from "../handlers";

class MockElement {
  tagName: string;
  attributes: Record<string, string> = {};
  listeners: Record<string, ((e?: any) => void)[]> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  getAttribute(name: string) {
    return this.attributes[name] || null;
  }

  addEventListener(type: string, listener: (e?: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  click() {
    const ev = { type: "click", target: this };
    (this.listeners["click"] || []).forEach((cb) => cb(ev));
  }

  dispatchEvent(ev: any) {
    (this.listeners[ev.type] || []).forEach((cb) => cb(ev));
    return true;
  }

  scrollIntoView() {}
}

let mockElements: MockElement[] = [];
let windowEvents: Record<string, ((e?: any) => void)[]> = {};

const mockDocument = {
  createElement: (tag: string) => {
    const el = new MockElement(tag);
    return el;
  },
  body: {
    appendChild: (el: any) => {
      mockElements.push(el);
      return el;
    },
    innerHTML: "",
  },
  querySelector: (selector: string) => {
    for (const el of mockElements) {
      if (selector.startsWith("[data-tour-id=")) {
        const match = selector.match(/\[data-tour-id="([^"]+)"\]/);
        if (match && el.getAttribute("data-tour-id") === match[1]) {
          return el;
        }
      }
      if (selector === el.tagName.toLowerCase() || selector === el.tagName) {
        return el;
      }
    }
    return null;
  },
};

const mockWindow = {
  location: { pathname: "/overview" },
  addEventListener: (type: string, cb: any) => {
    if (!windowEvents[type]) windowEvents[type] = [];
    windowEvents[type].push(cb);
  },
  removeEventListener: (type: string, cb: any) => {
    if (windowEvents[type]) {
      windowEvents[type] = windowEvents[type].filter((fn) => fn !== cb);
    }
  },
  dispatchEvent: (ev: any) => {
    (windowEvents[ev.type] || []).forEach((cb) => cb(ev));
    return true;
  },
};

class MockCustomEvent {
  type: string;
  detail: any;
  constructor(type: string, init?: { detail?: any }) {
    this.type = type;
    this.detail = init?.detail;
  }
}

class MockMouseEvent {
  type: string;
  constructor(type: string) {
    this.type = type;
  }
}

// Attach globals
Object.defineProperty(globalThis, "document", { value: mockDocument, writable: true });
Object.defineProperty(globalThis, "window", { value: mockWindow, writable: true });
Object.defineProperty(globalThis, "CustomEvent", { value: MockCustomEvent, writable: true });
Object.defineProperty(globalThis, "MouseEvent", { value: MockMouseEvent, writable: true });

// Mock localStorage
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
    for (const k in mockStorage) delete mockStorage[k];
  }),
};
Object.defineProperty(globalThis, "localStorage", { value: mockLocalStorage, writable: true });

describe("handlers.ts unit tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockElements = [];
    windowEvents = {};
    mockLocalStorage.clear();
    mockWindow.location.pathname = "/overview";
  });

  describe("resolveViewMode", () => {
    it("resolves overview view mode", () => {
      expect(resolveViewMode({ type: "overview" })).toEqual({ type: "overview" });
      expect(resolveViewMode({ mode: "overview" })).toEqual({ type: "overview" });
    });

    it("resolves modelAssets view mode", () => {
      expect(resolveViewMode({ type: "modelAssets" })).toEqual({ type: "modelAssets" });
      expect(resolveViewMode({ mode: "model_assets" })).toEqual({ type: "modelAssets" });
    });

    it("resolves playout view mode", () => {
      expect(resolveViewMode({ type: "playout" })).toEqual({ type: "playout" });
    });

    it("resolves analysis components correctly", () => {
      expect(resolveViewMode({ type: "analysis", component: "variants" })).toEqual({
        type: "analysis",
        component: "variants",
      });
      expect(resolveViewMode({ type: "analysis", component: "ocdfg" })).toEqual({
        type: "analysis",
        component: "ocdfg",
      });
      expect(resolveViewMode({ mode: "variants" })).toEqual({
        type: "analysis",
        component: "variants",
      });
      expect(resolveViewMode({ mode: "ocdfg" })).toEqual({
        type: "analysis",
        component: "ocdfg",
      });
      expect(resolveViewMode({ mode: "dotted_chart" })).toEqual({
        type: "analysis",
        component: "dottedChart",
      });
      expect(resolveViewMode({ mode: "process_area" })).toEqual({
        type: "analysis",
        component: "processArea",
      });
    });

    it("resolves conformance components", () => {
      expect(resolveViewMode({ type: "conformance", component: "totem" })).toEqual({
        type: "conformance",
        component: "totem",
      });
      expect(resolveViewMode({ type: "conformance", component: "occn" })).toEqual({
        type: "conformance",
        component: "occn",
      });
    });

    it("resolves editor components", () => {
      expect(resolveViewMode({ type: "editor", component: "ocpn" })).toEqual({
        type: "editor",
        component: "ocpn",
      });
    });

    it("resolves dashboard with ID", () => {
      expect(resolveViewMode({ type: "dashboard", id: 4 })).toEqual({
        type: "dashboard",
        id: 4,
      });
      expect(resolveViewMode({ mode: "dashboard", dashboard_id: 12 })).toEqual({
        type: "dashboard",
        id: 12,
      });
    });
  });

  describe("normalizeRoute", () => {
    it("normalizes /analysis and /analytics to /overview", () => {
      expect(normalizeRoute("/analysis")).toBe("/overview");
      expect(normalizeRoute("/analytics")).toBe("/overview");
    });

    it("normalizes /variants to /variantsview", () => {
      expect(normalizeRoute("/variants")).toBe("/variantsview");
    });

    it("leaves standard paths unchanged", () => {
      expect(normalizeRoute("/overview")).toBe("/overview");
      expect(normalizeRoute("/upload")).toBe("/upload");
      expect(normalizeRoute("/title")).toBe("/title");
    });
  });

  describe("executeCommand", () => {
    it("handles navigate command successfully", async () => {
      const mockNavigate = vi.fn();
      const eventSpy = vi.fn();
      mockWindow.addEventListener("totem:navigate", eventSpy);

      const cmd: AgentCommand = {
        action: "navigate",
        parameters: { route: "/variants", replace: true },
        correlation_id: "corr-nav-1",
      };

      const result = await executeCommand(cmd, { navigate: mockNavigate });

      expect(result.status).toBe("success");
      expect(result.correlation_id).toBe("corr-nav-1");
      expect(result.payload?.current_route).toBe("/variantsview");
      expect(mockNavigate).toHaveBeenCalledWith("/variantsview", { replace: true });
      expect(eventSpy).toHaveBeenCalled();
    });

    it("handles set_view_mode command and dispatches event", async () => {
      const mockSetViewMode = vi.fn();
      const eventSpy = vi.fn();
      mockWindow.addEventListener("totem:set-view-mode", eventSpy);

      const cmd: AgentCommand = {
        action: "set_view_mode",
        parameters: { mode: "variants" },
        correlation_id: "corr-vm-1",
      };

      const result = await executeCommand(cmd, { setViewMode: mockSetViewMode });

      expect(result.status).toBe("success");
      expect(result.payload?.active_mode).toEqual({ type: "analysis", component: "variants" });
      expect(mockSetViewMode).toHaveBeenCalledWith({ type: "analysis", component: "variants" });
      expect(eventSpy).toHaveBeenCalled();
    });

    it("handles click command with data-tour-id selector", async () => {
      const button = mockDocument.createElement("button");
      button.setAttribute("data-tour-id", "test-analysis-btn");
      const clickSpy = vi.fn();
      button.addEventListener("click", clickSpy);
      mockDocument.body.appendChild(button);

      const cmd: AgentCommand = {
        action: "click",
        parameters: { tour_id: "test-analysis-btn" },
        correlation_id: "corr-click-1",
      };

      const result = await executeCommand(cmd);

      expect(result.status).toBe("success");
      expect(result.payload?.clicked).toBe(true);
      expect(result.payload?.tag_name).toBe("BUTTON");
      expect(clickSpy).toHaveBeenCalled();
    });

    it("returns error when click target element is not found", async () => {
      const cmd: AgentCommand = {
        action: "click",
        parameters: { tour_id: "non-existent-btn" },
        correlation_id: "corr-click-err",
      };

      const result = await executeCommand(cmd);

      expect(result.status).toBe("error");
      expect(result.correlation_id).toBe("corr-click-err");
      expect(result.error).toContain("Element not found matching selector/tour_id");
    });

    it("handles create_dashboard command and dispatches totem:refresh-dashboard", async () => {
      const mockSetViewMode = vi.fn();
      let capturedEvent: any = null;
      mockWindow.addEventListener("totem:refresh-dashboard", (e: any) => {
        capturedEvent = e.detail;
      });

      const cmd: AgentCommand = {
        action: "create_dashboard",
        parameters: { name: "Executive KPI Dashboard", dashboard_id: 8, project_id: 2 },
        correlation_id: "corr-cd-1",
      };

      const result = await executeCommand(cmd, { setViewMode: mockSetViewMode });

      expect(result.status).toBe("success");
      expect(result.payload?.dashboard_name).toBe("Executive KPI Dashboard");
      expect(result.payload?.dashboard_id).toBe(8);
      expect(mockSetViewMode).toHaveBeenCalledWith({ type: "dashboard", id: 8 });
      expect(capturedEvent).toEqual({
        name: "Executive KPI Dashboard",
        dashboard_id: 8,
        project_id: 2,
      });
    });

    it("handles get_ui_state command", async () => {
      mockLocalStorage.setItem("totem_chat_mode", "act");

      const cmd: AgentCommand = {
        action: "get_ui_state",
        correlation_id: "corr-ui-state-1",
      };

      const deps: HandlerDependencies = {
        viewMode: { type: "analysis", component: "ocdfg" },
        selectedFile: { id: 10, filename: "financial.xes" },
      };

      const result = await executeCommand(cmd, deps);

      expect(result.status).toBe("success");
      expect(result.payload?.view_mode).toEqual({ type: "analysis", component: "ocdfg" });
      expect(result.payload?.selected_file).toEqual({ id: 10, filename: "financial.xes" });
      expect(result.payload?.chat_mode).toBe("act");
      expect(result.payload?.timestamp).toBeGreaterThan(0);
    });

    it("handles start_tour command with explicit steps", async () => {
      const mockStartTour = vi.fn();
      const eventSpy = vi.fn();
      mockWindow.addEventListener("agent:startTour", eventSpy);

      const steps = [
        { tour_id: "nav-overview", label: "Step 1" },
        { tour_id: "nav-analysis", label: "Step 2" },
      ];

      const cmd: AgentCommand = {
        action: "start_tour",
        parameters: { steps },
        correlation_id: "corr-tour-1",
      };

      const result = await executeCommand(cmd, { startTour: mockStartTour });

      expect(result.status).toBe("success");
      expect(result.payload?.started).toBe(true);
      expect(result.payload?.step_count).toBe(2);
      expect(mockStartTour).toHaveBeenCalledWith(steps);
      expect(eventSpy).toHaveBeenCalled();
    });

    it("handles start_tour command with single tour_id param", async () => {
      const mockStartTour = vi.fn();

      const cmd: AgentCommand = {
        action: "start_tour",
        parameters: { tour_id: "upload-button", label: "Upload XES Log" },
        correlation_id: "corr-tour-2",
      };

      const result = await executeCommand(cmd, { startTour: mockStartTour });

      expect(result.status).toBe("success");
      expect(result.payload?.step_count).toBe(1);
      expect(mockStartTour).toHaveBeenCalledWith([
        {
          tour_id: "upload-button",
          label: "Upload XES Log",
          title: undefined,
          description: undefined,
        },
      ]);
    });

    it("handles highlight_element command", async () => {
      const mockStartTour = vi.fn();
      const eventSpy = vi.fn();
      mockWindow.addEventListener("agent:highlightElement", eventSpy);

      const cmd: AgentCommand = {
        action: "highlight_element",
        parameters: {
          tour_id: "nav-conformance",
          label: "Conformance Checking Tab",
          title: "Alignments",
        },
        correlation_id: "corr-hl-1",
      };

      const result = await executeCommand(cmd, { startTour: mockStartTour });

      expect(result.status).toBe("success");
      expect(result.payload?.highlighted).toBe(true);
      expect(result.payload?.tour_id).toBe("nav-conformance");
      expect(mockStartTour).toHaveBeenCalledWith([
        {
          tour_id: "nav-conformance",
          label: "Conformance Checking Tab",
          title: "Alignments",
          description: undefined,
        },
      ]);
      expect(eventSpy).toHaveBeenCalled();
    });

    it("returns error for unknown action", async () => {
      const cmd: AgentCommand = {
        action: "unsupported_command",
        correlation_id: "corr-unknown",
      };

      const result = await executeCommand(cmd);

      expect(result.status).toBe("error");
      expect(result.correlation_id).toBe("corr-unknown");
      expect(result.error).toContain("Unknown command action: unsupported_command");
    });

    it("returns error when action is missing", async () => {
      const cmd = {} as AgentCommand;
      const result = await executeCommand(cmd);

      expect(result.status).toBe("error");
      expect(result.error).toBe("Missing command action");
    });
  });
});
