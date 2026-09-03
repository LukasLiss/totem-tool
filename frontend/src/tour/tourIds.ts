/**
 * Synchronized catalog of data-tour-id element identifiers and tour types.
 */

export const TOUR_IDS = {
  NAV_OVERVIEW: "nav-overview",
  NAV_ANALYSIS: "nav-analysis",
  NAV_CONFORMANCE: "nav-conformance",
  NAV_PLAYOUT: "nav-playout",
  NAV_DASHBOARD: "nav-dashboard",
  NAV_PROJECT: "nav-project",
  UPLOAD_BUTTON: "upload-button",
  CHAT_TOGGLE: "chat-toggle",
  CHAT_DRAWER: "chat-drawer",
  CHAT_INPUT: "chat-input",
  CHAT_MODE_TEACH: "chat-mode-teach",
  CHAT_MODE_ACT: "chat-mode-act",
  DASHBOARD_GRID: "dashboard-grid",
  DASHBOARD_ADD_CARD: "dashboard-add-card",
  DASHBOARD_ADD_BTN: "dashboard-add-btn",
  DASHBOARD_NAME_INPUT: "dashboard-name-input",
  DASHBOARD_SAVE_BTN: "dashboard-save-btn",
  FILE_SELECTOR: "file-selector",
  PROJECT_SWITCHER: "project-switcher",
  VIEW_MODE_SELECTOR: "view-mode-selector",
  OPEN_DOTTED_CHART: "open-dotted-chart",
} as const;

export type TourId = (typeof TOUR_IDS)[keyof typeof TOUR_IDS] | string;

export interface TourStep {
  tour_id: TourId;
  label: string;
  title?: string;
  description?: string;
}
