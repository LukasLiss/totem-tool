/**
 * Centralized catalogue of all valid data-tour-id values.
 *
 * MUST stay in sync with TOUR_ID_CATALOGUE in backend/assistant/prompts.py.
 */

export const TOUR_IDS = {
  SIDEBAR_OVERVIEW: "sidebar-overview",
  SIDEBAR_ANALYSIS: "sidebar-analysis",
  SIDEBAR_CONFORMANCE: "sidebar-conformance",
  SIDEBAR_DASHBOARD: "sidebar-dashboard",
  SIDEBAR_EDITOR: "sidebar-editor",
  SIDEBAR_PLAYOUT: "sidebar-playout",
  SIDEBAR_PROJECT: "sidebar-project",
  UPLOAD_AREA: "upload-area",
  VARIANTS_TABLE: "variants-table",
  PROCESS_AREA_CANVAS: "process-area-canvas",
  DOTTED_CHART_CANVAS: "dotted-chart-canvas",
  OCDFG_CANVAS: "ocdfg-canvas",
  OCCN_CANVAS: "occn-canvas",
  MLPA_CANVAS: "mlpa-canvas",
  DASHBOARD_GRID: "dashboard-grid",
  DASHBOARD_ADD_COMPONENT: "dashboard-add-component",
  SETTINGS_EXTRACTION: "settings-extraction",
  SETTINGS_ISO: "settings-iso",
  SETTINGS_TIMEOUT: "settings-timeout",
  EDITOR_TOOLBAR: "editor-toolbar",
  EDITOR_CANVAS: "editor-canvas",
  PLAYOUT_CONTROLS: "playout-controls",
} as const;

export type TourId = (typeof TOUR_IDS)[keyof typeof TOUR_IDS];

export interface TourStep {
  tour_id: TourId;
  label: string;
}
