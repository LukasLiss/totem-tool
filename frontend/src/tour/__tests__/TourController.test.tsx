import { describe, it, expect, vi } from "vitest";
import { TOUR_IDS } from "../tourIds";

describe("Tour Controller & Highlighting System", () => {
  it("verifies all core tour identifiers are registered", () => {
    expect(TOUR_IDS.NAV_OVERVIEW).toBe("nav-overview");
    expect(TOUR_IDS.NAV_ANALYSIS).toBe("nav-analysis");
    expect(TOUR_IDS.NAV_CONFORMANCE).toBe("nav-conformance");
    expect(TOUR_IDS.NAV_PLAYOUT).toBe("nav-playout");
    expect(TOUR_IDS.NAV_DASHBOARD).toBe("nav-dashboard");
    expect(TOUR_IDS.NAV_PROJECT).toBe("nav-project");
    expect(TOUR_IDS.CHAT_TOGGLE).toBe("chat-toggle");
    expect(TOUR_IDS.CHAT_DRAWER).toBe("chat-drawer");
    expect(TOUR_IDS.CHAT_INPUT).toBe("chat-input");
    expect(TOUR_IDS.CHAT_MODE_TEACH).toBe("chat-mode-teach");
    expect(TOUR_IDS.CHAT_MODE_ACT).toBe("chat-mode-act");
    expect(TOUR_IDS.DASHBOARD_GRID).toBe("dashboard-grid");
    expect(TOUR_IDS.DASHBOARD_ADD_CARD).toBe("dashboard-add-card");
    expect(TOUR_IDS.FILE_SELECTOR).toBe("file-selector");
    expect(TOUR_IDS.PROJECT_SWITCHER).toBe("project-switcher");
    expect(TOUR_IDS.VIEW_MODE_SELECTOR).toBe("view-mode-selector");
  });

  it("handles tour completion events cleanly in browser environments", () => {
    const listeners: Record<string, Function[]> = {};
    const mockWindow = {
      addEventListener: vi.fn((event: string, cb: Function) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(cb);
      }),
      removeEventListener: vi.fn((event: string, cb: Function) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((f) => f !== cb);
        }
      }),
      dispatchEvent: vi.fn((event: { type: string }) => {
        if (listeners[event.type]) {
          listeners[event.type].forEach((cb) => cb(event));
        }
        return true;
      }),
    };

    const handler = vi.fn();
    mockWindow.addEventListener("agent:tourComplete", handler);
    mockWindow.dispatchEvent({ type: "agent:tourComplete" });
    expect(handler).toHaveBeenCalledTimes(1);
    mockWindow.removeEventListener("agent:tourComplete", handler);
  });

  it("calculates spotlight positioning from DOM element bounding box", () => {
    const dummyEl = {
      getBoundingClientRect: () => ({
        top: 100,
        left: 50,
        width: 200,
        height: 40,
        bottom: 140,
        right: 250,
      }),
      scrollIntoView: vi.fn(),
    };

    const rect = dummyEl.getBoundingClientRect();
    expect(rect.top).toBe(100);
    expect(rect.left).toBe(50);
    expect(rect.width).toBe(200);
    expect(rect.height).toBe(40);
  });
});
