import type { ViewMode } from "@/contexts/DashboardContext";
import type { TourStep } from "@/api/assistantApi";

/** What the browser-side assistant tools need from the app. */
export interface ClientActionDeps {
  setViewMode?: (mode: ViewMode) => void;
  navigate?: (path: string) => void;
  startTour?: (steps: TourStep[]) => void;
  /** Called before a tour so the spotlight is not hidden behind the chat drawer. */
  onTourStart?: () => void;
}

const ANALYSIS: Record<string, ViewMode> = {
  ocdfg: { type: "analysis", component: "ocdfg" },
  variants: { type: "analysis", component: "variants" },
  dotted_chart: { type: "analysis", component: "dottedChart" },
  occn: { type: "analysis", component: "occn" },
  process_area: { type: "analysis", component: "processArea" },
};

/** Map the `open_view` tool arguments (backend mcp_server/server.py) to an app view. */
export function viewFromArgs(args: Record<string, unknown>): ViewMode | null {
  const view = String(args.view ?? "");
  const component = String(args.component ?? "");
  switch (view) {
    case "overview":
      return { type: "overview" };
    case "playout":
      return { type: "playout" };
    case "model_assets":
      return { type: "modelAssets" };
    case "analysis":
      return ANALYSIS[component] ?? ANALYSIS.ocdfg;
    case "conformance":
      return { type: "conformance", component: component === "occn" ? "occn" : "totem" };
    case "editor":
      return { type: "editor", component: component === "occn" ? "occn" : component === "ocpn" ? "ocpn" : "totem" };
    case "dashboard": {
      const id = Number(args.dashboard_id);
      return Number.isInteger(id) && id > 0 ? { type: "dashboard", id } : null;
    }
    default:
      return null;
  }
}

/** Execute a browser-side tool call. Returns false when it could not be applied. */
export function runClientAction(name: string, args: Record<string, unknown>, deps: ClientActionDeps): boolean {
  if (name === "open_view") {
    const mode = viewFromArgs(args);
    if (!mode || !deps.setViewMode) return false;
    deps.navigate?.("/overview");
    deps.setViewMode(mode);
    return true;
  }
  if (name === "start_tour") {
    const steps = Array.isArray(args.steps)
      ? (args.steps as Array<Record<string, unknown>>)
          .filter((s) => typeof s?.tour_id === "string")
          .map((s) => ({ tour_id: String(s.tour_id), label: String(s.label ?? "") }))
      : [];
    if (!steps.length || !deps.startTour) return false;
    deps.onTourStart?.();
    deps.startTour(steps);
    return true;
  }
  return false;
}
