import React, { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/api/assistantApi";

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

  const handleDecision = async (id: string, approved: boolean, name: string, actionArgs: Record<string, unknown>) => {
    setDeciding((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await confirmAction(id, approved);
      // If this was a dashboard-mutating tool and it was approved, trigger a grid refresh & auto-selection
      if (approved && DASHBOARD_MUTATING_TOOLS.has(name)) {
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
      }
    } catch {
      // Best-effort — server may not implement storage yet
    }
    onResolved(id);
  };

  const visibleActions = actions.filter((a) => DASHBOARD_MUTATING_TOOLS.has(a.name) || a.name.startsWith("create_") || a.name.startsWith("delete_") || a.name.startsWith("remove_") || a.name.startsWith("update_") || a.name.startsWith("rename_"));

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
