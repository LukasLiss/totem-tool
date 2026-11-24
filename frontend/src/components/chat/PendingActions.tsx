import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmAction, PendingAction } from "@/api/assistantApi";

export type PendingActionItem = PendingAction;

export type ActionOutcome = "executed" | "cancelled" | "failed";

export interface PendingActionsProps {
  actions: PendingActionItem[];
  onResolved: (actionId: string, outcome: ActionOutcome, detail?: string) => void;
}

const DASHBOARD_TOOLS = new Set([
  "create_dashboard",
  "add_component",
  "update_component",
  "remove_component",
  "rename_dashboard",
  "delete_dashboard",
]);

function refreshDashboards(name: string, result: Record<string, unknown> | null | undefined, args: Record<string, unknown>) {
  if (!DASHBOARD_TOOLS.has(name)) return;
  const dashboardId = (result?.dashboard_id as number | undefined) ?? (args.dashboard_id as number | undefined);
  window.dispatchEvent(new CustomEvent("totem:refresh-dashboard", { detail: { dashboard_id: dashboardId } }));
  if (name === "create_dashboard" && dashboardId) {
    window.dispatchEvent(new CustomEvent("totem:select-dashboard", { detail: { dashboard_id: dashboardId } }));
  }
}

/** Approval cards for changes the assistant proposed. Nothing changes until the user approves. */
export function PendingActions({ actions, onResolved }: PendingActionsProps) {
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const decide = async (action: PendingActionItem, approved: boolean) => {
    setBusy((b) => ({ ...b, [action.id]: true }));
    try {
      const res = await confirmAction(action.id, approved);
      if (res.status === "executed") {
        refreshDashboards(action.name, res.result, action.arguments);
        toast.success(action.description);
        onResolved(action.id, "executed");
      } else if (res.status === "cancelled") {
        onResolved(action.id, "cancelled");
      } else {
        const message = res.error || "The change could not be applied.";
        toast.error(message);
        onResolved(action.id, "failed", message);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not reach the server.");
      setBusy((b) => ({ ...b, [action.id]: false }));
    }
  };

  if (actions.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-2">
      {actions.map((action) => (
        <div
          key={action.id}
          data-testid="pending-action"
          className="flex items-center justify-between gap-3 rounded-lg border border-amber-300/70 bg-amber-50/60 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/30"
        >
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Needs your approval
            </div>
            <div className="truncate text-foreground" title={action.description}>
              {action.description}
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              disabled={!!busy[action.id]}
              onClick={() => decide(action, false)}
            >
              <X className="size-3" /> Decline
            </Button>
            <Button size="sm" className="h-7 gap-1 px-2 text-xs" disabled={!!busy[action.id]} onClick={() => decide(action, true)}>
              {busy[action.id] ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Approve
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
