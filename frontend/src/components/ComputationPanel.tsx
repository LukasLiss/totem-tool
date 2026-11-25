import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useComputationStore, type Computation } from "@/store/computationStore";

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

/** Re-renders every second so elapsed times tick. */
function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function ProgressBar({ fraction, cancelling }: { fraction: number | null; cancelling?: boolean }) {
  const determinate = typeof fraction === "number";
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(fraction * 100) : undefined}
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      {determinate ? (
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${cancelling ? "bg-muted-foreground" : "bg-primary"}`}
          style={{ width: `${Math.max(2, Math.min(100, fraction * 100))}%` }}
        />
      ) : (
        <div
          className={`absolute inset-y-0 w-1/3 rounded-full ${cancelling ? "bg-muted-foreground" : "bg-primary"}`}
          style={{ animation: "totem-progress-slide 1.2s ease-in-out infinite" }}
        />
      )}
    </div>
  );
}

export function ComputationRow({
  job,
  now,
  compact = false,
}: {
  job: Computation;
  now: number;
  compact?: boolean;
}) {
  const cancel = useComputationStore((s) => s.cancel);
  const cancelling = job.status === "cancelling";
  const percent = typeof job.fraction === "number" ? `${Math.round(job.fraction * 100)}%` : null;
  return (
    <div data-testid="computation-row" data-job-id={job.id} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
        <span className={`font-medium truncate ${compact ? "text-xs" : "text-sm"}`}>{job.label}</span>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {percent ? `${percent} · ` : ""}{formatElapsed(now - job.startedAt)}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs shrink-0"
          disabled={cancelling}
          onClick={() => cancel(job.id)}
          aria-label={`Cancel ${job.label}`}
          data-testid="computation-cancel"
        >
          <X size={12} className="mr-1" />
          {cancelling ? "Cancelling" : "Cancel"}
        </Button>
      </div>
      <ProgressBar fraction={job.fraction} cancelling={cancelling} />
      {(job.message || cancelling) && (
        <div className="text-[11px] text-muted-foreground truncate">
          {cancelling ? "Stopping the computation…" : job.message}
        </div>
      )}
    </div>
  );
}

/**
 * Floating list of every running computation with progress and a Cancel
 * button. Mounted once in the app shell; renders nothing while idle.
 */
export default function ComputationPanel() {
  const jobs = useComputationStore((s) => s.jobs);
  const cancelAll = useComputationStore((s) => s.cancelAll);
  const list = Object.values(jobs).sort((a, b) => a.startedAt - b.startedAt);
  const now = useClock(list.length > 0);
  if (list.length === 0) return null;

  return (
    <div
      data-testid="computation-panel"
      className="fixed bottom-4 right-4 z-[60] w-[340px] max-w-[calc(100vw-2rem)] rounded-lg border bg-card text-card-foreground shadow-lg"
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {list.length === 1 ? "Running computation" : `${list.length} running computations`}
        </span>
        {list.length > 1 && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={cancelAll}>
            Cancel all
          </Button>
        )}
      </div>
      <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto px-3 py-3">
        {list.map((job) => (
          <ComputationRow key={job.id} job={job} now={now} />
        ))}
      </div>
    </div>
  );
}
