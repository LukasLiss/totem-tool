import { useId, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatToolDuration } from "./chatFormat";

/** One tool call made by the assistant during a turn, as built from `tool_start` / `tool_end` events. */
export interface ToolExecution {
  id: string;
  name: string;
  summary: string;
  status: "executing" | "completed" | "failed";
  error?: string;
  durationMs?: number;
}

const STATUS_LABEL: Record<ToolExecution["status"], string> = {
  executing: "Running",
  completed: "Done",
  failed: "Failed",
};

/** A compact tool-call chip; click it to see the tool name, duration and any error. */
export function ToolChip({ tool, defaultExpanded = false }: { tool: ToolExecution; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const detailsId = useId();
  const failed = tool.status === "failed";

  return (
    <div
      data-testid="tool-chip"
      data-status={tool.status}
      className="rounded border bg-background/80 text-xs text-muted-foreground"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left rounded hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {tool.status === "executing" ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-primary" aria-hidden />
        ) : tool.status === "completed" ? (
          <CheckCircle2 className="size-3 shrink-0 text-emerald-500" aria-hidden />
        ) : (
          <AlertCircle className="size-3 shrink-0 text-amber-500" aria-hidden />
        )}
        <span className="truncate">{tool.summary || tool.name}</span>
        {failed && tool.error && !expanded && (
          <span className="truncate text-amber-600 dark:text-amber-400">· {tool.error}</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {tool.durationMs !== undefined && tool.durationMs >= 1000 && (
            <span className="tabular-nums">{formatToolDuration(tool.durationMs)}</span>
          )}
          <ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} aria-hidden />
        </span>
      </button>
      {expanded && (
        <dl
          id={detailsId}
          data-testid="tool-chip-details"
          className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t px-2 py-1.5"
        >
          <dt className="text-muted-foreground/80">Tool</dt>
          <dd className="font-mono break-all text-foreground">{tool.name}</dd>
          <dt className="text-muted-foreground/80">Status</dt>
          <dd className="text-foreground">{STATUS_LABEL[tool.status]}</dd>
          {tool.durationMs !== undefined && (
            <>
              <dt className="text-muted-foreground/80">Duration</dt>
              <dd className="tabular-nums text-foreground">{formatToolDuration(tool.durationMs)}</dd>
            </>
          )}
          {tool.error && (
            <>
              <dt className="text-muted-foreground/80">Error</dt>
              <dd className="whitespace-pre-wrap break-words text-amber-700 dark:text-amber-400">{tool.error}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

export default ToolChip;
