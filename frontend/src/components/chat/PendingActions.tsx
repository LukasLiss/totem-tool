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

export function PendingActions({ actions, onResolved }: PendingActionsProps) {
  const [deciding, setDeciding] = useState<Record<string, boolean>>({});

  const handleDecision = async (id: string, approved: boolean) => {
    setDeciding((prev) => ({ ...prev, [id]: true }));
    try {
      await confirmAction(id, approved);
    } catch {
      // Best-effort — server may not implement storage yet
    }
    onResolved(id);
  };

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-4 pb-2">
      {actions.map((action) => (
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
              onClick={() => handleDecision(action.id, true)}
            >
              <Check className="size-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-5 text-red-600 hover:text-red-700 hover:bg-red-100"
              disabled={!!deciding[action.id]}
              onClick={() => handleDecision(action.id, false)}
            >
              <X className="size-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
