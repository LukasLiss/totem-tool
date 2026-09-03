import React, { useState, useContext } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/api/assistantApi";
import { DashboardContext } from "@/contexts/DashboardContext";
import { resolveViewMode } from "./handlers";
import { useNavigate } from "react-router-dom";

export interface PendingActionItem {
  id: string;
  name: string;
  description: string;
  arguments: Record<string, unknown>;
}

interface PendingActionsProps {
  actions: PendingActionItem[];
  onResolved: (id: string) => void;
}

const DASHBOARD_MUTATING_TOOLS = new Set([
  "create_dashboard",
  "add_component",
  "remove_component",
  "update_component",
  "rename_dashboard",
  "delete_dashboard",
]);

export function PendingActions({ actions, onResolved }: PendingActionsProps) {
  const [deciding, setDeciding] = useState<Record<string, boolean>>({});
  const dashboardCtx = useContext(DashboardContext);
  let navigate: ReturnType<typeof useNavigate> | undefined;
  try {
    navigate = useNavigate();
  } catch {
    // Router context not available
  }

  const handleDecision = async (id: string, approved: boolean, name: string, actionArgs: Record<string, unknown>) => {
    setDeciding((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await confirmAction(id, approved);
      if (approved) {
        // If this was a dashboard-mutating tool and it was approved, trigger a grid refresh & auto-selection
        if (DASHBOARD_MUTATING_TOOLS.has(name)) {
          const targetId = (res as any)?.result?.id ?? actionArgs?.dashboard_id;
          window.dispatchEvent(
            new CustomEvent("totem:refresh-dashboard", {
              detail: { dashboard_id: targetId },
            })
          );
          if (targetId) {
            window.dispatchEvent(
              new CustomEvent("totem:select-dashboard", {
                detail: { dashboard_id: targetId },
              })
            );
          }
        } else if (name === "set_view_mode") {
          const targetMode = resolveViewMode(actionArgs);
          dashboardCtx?.setViewMode?.(targetMode);
          if (navigate) {
            navigate("/overview");
          }
          window.dispatchEvent(
            new CustomEvent("totem:set-view-mode", {
              detail: actionArgs,
            })
          );
        } else if (name === "navigate") {
          const route = String(actionArgs.route || actionArgs.path || "/");
          if (navigate) {
            navigate(route);
          }
          window.dispatchEvent(
            new CustomEvent("totem:navigate", {
              detail: { route },
            })
          );
        }
      }
    } catch {
      // Best-effort — server may not implement storage yet
    }
    onResolved(id);
  };

  const visibleActions = actions.filter(
    (a) =>
      DASHBOARD_MUTATING_TOOLS.has(a.name) ||
      a.name === "set_view_mode" ||
      a.name === "navigate" ||
      a.name.startsWith("create_") ||
      a.name.startsWith("delete_") ||
      a.name.startsWith("remove_") ||
      a.name.startsWith("update_") ||
      a.name.startsWith("rename_")
  );

  if (visibleActions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-4 pb-2">
      {visibleActions.map((action) => (
        <div
          key={action.id}
          className="flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1.5 text-xs"
        >
          <span className="max-w-[200px] truncate">{action.description}</span>
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-5 text-green-600 hover:text-green-700 hover:bg-green-100"
              disabled={!!deciding[action.id]}
              onClick={() => handleDecision(action.id, true, action.name, action.arguments)}
            >
              <Check className="size-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-5 text-red-600 hover:text-red-700 hover:bg-red-100"
              disabled={!!deciding[action.id]}
              onClick={() => handleDecision(action.id, false, action.name, action.arguments)}
            >
              <X className="size-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
