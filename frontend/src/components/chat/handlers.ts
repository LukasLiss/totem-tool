/**
 * UI Command Execution Handlers for Totem Real-Time Agent Bridge.
 *
 * Implements client-side execution of live-wire agent commands:
 * - navigate: Programmatic route transition
 * - set_view_mode: Switch active visualization/analysis tab
 * - click: Locate DOM element by data-tour-id or selector and trigger click
 * - create_dashboard: Trigger dashboard refresh or creation event
 * - get_ui_state: Aggregate snapshot of current client UI state
 * - start_tour: Launch guided walkthrough via TourController
 * - highlight_element: Spotlight specific UI element for Teach Mode
 */

import { ViewMode, AnalysisComponent, ConformanceComponent, EditorComponent } from "@/contexts/DashboardContext";
import { TourStep, TourId } from "@/tour/tourIds";

export interface HandlerDependencies {
  navigate?: (path: string, options?: { replace?: boolean }) => void;
  setViewMode?: (mode: ViewMode) => void;
  selectedFile?: any;
  viewMode?: ViewMode;
  startTour?: (steps: TourStep[]) => void;
}

export type CommandAction =
  | "navigate"
  | "set_view_mode"
  | "click"
  | "create_dashboard"
  | "get_ui_state"
  | "start_tour"
  | "highlight_element";

export interface AgentCommand {
  action: CommandAction | string;
  parameters?: Record<string, any>;
  correlation_id?: string;
}

export interface AgentCommandResponse {
  status: "success" | "error";
  correlation_id?: string;
  payload?: Record<string, any>;
  error?: string;
}

/**
 * Normalizes input mode/type strings into a strongly-typed ViewMode.
 */
export function resolveViewMode(params: Record<string, any>): ViewMode {
  const modeOrType = (params.type || params.mode || "overview").toString().toLowerCase();

  if (modeOrType === "overview") {
    return { type: "overview" };
  }
  if (modeOrType === "modelassets" || modeOrType === "model_assets") {
    return { type: "modelAssets" };
  }
  if (modeOrType === "playout") {
    return { type: "playout" };
  }
  if (modeOrType === "dashboard") {
    const id = Number(params.id || params.dashboard_id || 1);
    return { type: "dashboard", id: isNaN(id) ? 1 : id };
  }

  // Analysis components
  const analysisComponents: Record<string, AnalysisComponent> = {
    processarea: "processArea",
    process_area: "processArea",
    ocdfg: "ocdfg",
    dfg: "ocdfg",
    variants: "variants",
    dottedchart: "dottedChart",
    dotted_chart: "dottedChart",
    occn: "occn",
  };

  if (modeOrType === "analysis") {
    const rawComp = (params.component || "ocdfg").toString().toLowerCase();
    const component = analysisComponents[rawComp] || "ocdfg";
    return { type: "analysis", component };
  }
  if (modeOrType in analysisComponents) {
    return { type: "analysis", component: analysisComponents[modeOrType] };
  }

  // Conformance components
  if (modeOrType === "conformance") {
    const rawComp = (params.component || "totem").toString().toLowerCase();
    const component: ConformanceComponent = rawComp === "occn" ? "occn" : "totem";
    return { type: "conformance", component };
  }

  // Editor components
  if (modeOrType === "editor") {
    const rawComp = (params.component || "totem").toString().toLowerCase();
    let component: EditorComponent = "totem";
    if (rawComp === "occn") component = "occn";
    else if (rawComp === "ocpn") component = "ocpn";
    return { type: "editor", component };
  }

  return { type: "overview" };
}

/**
 * Normalizes route path strings.
 */
export function normalizeRoute(rawRoute: string): string {
  const trimmed = rawRoute.trim();
  if (!trimmed) return "/overview";
  if (trimmed === "/analysis" || trimmed === "/analytics") return "/overview";
  if (trimmed === "/variants") return "/variantsview";
  return trimmed;
}

/**
 * Main command dispatcher that executes incoming agent live-wire commands.
 */
export async function executeCommand(
  command: AgentCommand,
  deps?: HandlerDependencies
): Promise<AgentCommandResponse> {
  const correlation_id = command?.correlation_id;

  if (!command || !command.action) {
    return {
      status: "error",
      correlation_id,
      error: "Missing command action",
    };
  }

  const action = command.action;
  const params = command.parameters || {};

  try {
    switch (action) {
      case "navigate": {
        const rawRoute = params.route || params.path || params.to || "/";
        const targetRoute = normalizeRoute(rawRoute);
        const prevPath = typeof window !== "undefined" ? window.location.pathname : "";

        if (deps?.navigate) {
          deps.navigate(targetRoute, { replace: !!params.replace });
        }

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("totem:navigate", {
              detail: { route: targetRoute, replace: !!params.replace },
            })
          );
        }

        return {
          status: "success",
          correlation_id,
          payload: {
            current_route: targetRoute,
            previous_path: prevPath,
          },
        };
      }

      case "set_view_mode": {
        const targetMode = resolveViewMode(params);

        if (deps?.setViewMode) {
          deps.setViewMode(targetMode);
        }

        // If not already on /overview and navigate is provided, ensure we are on /overview
        const currentPath = typeof window !== "undefined" ? window.location.pathname : "";
        if (currentPath !== "/overview" && deps?.navigate) {
          deps.navigate("/overview");
        }

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("totem:set-view-mode", {
              detail: targetMode,
            })
          );
        }

        return {
          status: "success",
          correlation_id,
          payload: {
            active_mode: targetMode,
          },
        };
      }

      case "click": {
        const tourId = params.tour_id || params.data_tour_id;
        const selector = params.selector;

        let targetSelector = "";
        if (tourId) {
          targetSelector = `[data-tour-id="${tourId}"]`;
        } else if (selector) {
          targetSelector = selector;
        } else {
          throw new Error("Missing selector or tour_id parameter for click action");
        }

        if (typeof document === "undefined") {
          throw new Error("DOM document is not available");
        }

        const element = document.querySelector(targetSelector) as HTMLElement | null;
        if (!element) {
          throw new Error(`Element not found matching selector/tour_id: ${tourId || selector}`);
        }

        if (typeof element.scrollIntoView === "function") {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }

        if (typeof element.click === "function") {
          element.click();
        } else {
          element.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              view: window,
            })
          );
        }

        return {
          status: "success",
          correlation_id,
          payload: {
            clicked: true,
            target: tourId || selector,
            tag_name: element.tagName,
          },
        };
      }

      case "create_dashboard": {
        const name = params.name || "New Dashboard";
        const dashboard_id = params.dashboard_id !== undefined ? Number(params.dashboard_id) : (params.id !== undefined ? Number(params.id) : undefined);
        const project_id = params.project_id !== undefined ? Number(params.project_id) : undefined;

        if (dashboard_id !== undefined && deps?.setViewMode) {
          deps.setViewMode({ type: "dashboard", id: dashboard_id });
        }

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("totem:refresh-dashboard", {
              detail: { name, dashboard_id, project_id },
            })
          );
        }

        return {
          status: "success",
          correlation_id,
          payload: {
            success: true,
            dashboard_name: name,
            dashboard_id: dashboard_id ?? null,
          },
        };
      }

      case "get_ui_state": {
        const pathname = typeof window !== "undefined" ? window.location.pathname : "";
        const view_mode = deps?.viewMode || { type: "overview" };
        const selected_file = deps?.selectedFile || null;
        let chat_mode = "teach";

        try {
          if (typeof localStorage !== "undefined") {
            chat_mode = localStorage.getItem("totem_chat_mode") || "teach";
          }
        } catch {
          // Ignore
        }

        return {
          status: "success",
          correlation_id,
          payload: {
            pathname,
            view_mode,
            selected_file,
            chat_mode,
            timestamp: Date.now(),
          },
        };
      }

      case "start_tour": {
        let steps: TourStep[] = [];
        if (Array.isArray(params.steps) && params.steps.length > 0) {
          steps = params.steps;
        } else if (params.tour_id) {
          steps = [
            {
              tour_id: params.tour_id as TourId,
              label: params.label || params.title || "Guided Step",
              title: params.title,
              description: params.description,
            },
          ];
        } else {
          throw new Error("Missing steps or tour_id parameter for start_tour action");
        }

        if (deps?.startTour) {
          deps.startTour(steps);
        }

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("agent:startTour", {
              detail: { steps, initial_step: params.initial_step || 0 },
            })
          );
          window.dispatchEvent(
            new CustomEvent("totem:start-tour", {
              detail: { steps },
            })
          );
        }

        return {
          status: "success",
          correlation_id,
          payload: {
            started: true,
            step_count: steps.length,
            steps,
          },
        };
      }

      case "highlight_element": {
        const tourId = params.tour_id || params.data_tour_id;
        if (!tourId) {
          throw new Error("Missing tour_id parameter for highlight_element action");
        }

        const step: TourStep = {
          tour_id: tourId as TourId,
          label: params.label || params.title || "Highlighted Element",
          title: params.title,
          description: params.description,
        };

        if (deps?.startTour) {
          deps.startTour([step]);
        }

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("agent:highlightElement", {
              detail: {
                tour_id: tourId,
                label: step.label,
                title: params.title,
                description: params.description,
              },
            })
          );
          window.dispatchEvent(
            new CustomEvent("totem:highlight-element", {
              detail: step,
            })
          );
        }

        return {
          status: "success",
          correlation_id,
          payload: {
            highlighted: true,
            tour_id: tourId,
          },
        };
      }

      default:
        throw new Error(`Unknown command action: ${action}`);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      correlation_id,
      error: errorMsg,
    };
  }
}
