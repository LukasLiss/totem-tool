/**
 * Command handler registry.
 *
 * Maps command names dispatched from the WebSocket consumer to actions
 * on the client side (routing, context updates, custom events).
 */

import type { CommandHandler } from "./types";

const handlers = new Map<string, CommandHandler>();

export function registerHandler(
  command: string,
  handler: CommandHandler
): void {
  handlers.set(command, handler);
}

export function dispatchCommand(
  command: string,
  args: Record<string, unknown>
): void {
  const handler = handlers.get(command);
  if (handler) {
    handler(args);
  } else {
    console.warn(`[AgentBridge] No handler registered for command: ${command}`);
  }
}

// ---------------------------------------------------------------------------
// Built-in handlers
// ---------------------------------------------------------------------------

export function registerBuiltinHandlers(): void {
  registerHandler("navigate", (args) => {
    const route = args.route as string | undefined;
    if (route && typeof window !== "undefined") {
      // Use history.pushState so React Router picks up the change
      window.history.pushState(null, "", route);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  });

  registerHandler("set_view_mode", (args) => {
    // Dispatch a custom event that DashboardContext consumers can listen for.
    // The event detail carries the view mode payload.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent:setViewMode", { detail: args })
      );
    }
  });

  registerHandler("highlight_element", (args) => {
    const tourId = args.tour_id as string | undefined;
    const label = (args.label as string) || "";
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent:highlight", {
          detail: { tourId, label },
        })
      );
    }
  });

  registerHandler("refresh_dashboard", (args) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("totem:refresh-dashboard", { detail: args })
      );
    }
  });
}
