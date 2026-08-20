import { describe, it, expect } from "vitest";
import { TOUR_IDS, TourStep, TourId } from "../tourIds";

describe("tourIds and contracts", () => {
  it("should have all required TOUR_IDS defined as non-empty strings", () => {
    expect(TOUR_IDS.NAV_OVERVIEW).toBe("nav-overview");
    expect(TOUR_IDS.NAV_ANALYSIS).toBe("nav-analysis");
    expect(TOUR_IDS.NAV_CONFORMANCE).toBe("nav-conformance");
    expect(TOUR_IDS.NAV_PLAYOUT).toBe("nav-playout");
    expect(TOUR_IDS.NAV_DASHBOARD).toBe("nav-dashboard");
    expect(TOUR_IDS.NAV_PROJECT).toBe("nav-project");
    expect(TOUR_IDS.UPLOAD_BUTTON).toBe("upload-button");
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

    for (const [key, val] of Object.entries(TOUR_IDS)) {
      expect(typeof val).toBe("string");
      expect(val.length).toBeGreaterThan(0);
      expect(val).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("should validate TourStep structure conforming to interface", () => {
    const step: TourStep = {
      tour_id: TOUR_IDS.NAV_DASHBOARD,
      label: "Dashboard View",
      title: "Explore Dashboards",
      description: "Click here to view interactive process dashboards.",
    };

    expect(step.tour_id).toBe("nav-dashboard");
    expect(step.label).toBe("Dashboard View");
    expect(step.title).toBe("Explore Dashboards");
    expect(step.description).toBe("Click here to view interactive process dashboards.");
  });

  it("should support custom tour_id strings in TourId type", () => {
    const customId: TourId = "custom-dom-element-id";
    const step: TourStep = {
      tour_id: customId,
      label: "Custom Element",
    };
    expect(step.tour_id).toBe("custom-dom-element-id");
  });
});
