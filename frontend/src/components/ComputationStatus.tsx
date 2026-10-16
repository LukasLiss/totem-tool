import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { ComputationRow } from "@/components/ComputationPanel";
import { selectComputations, useComputationStore } from "@/store/computationStore";

type Props = {
  /** Restrict to computations of this event log. */
  fileId?: number | string | null;
  /** Restrict to requests whose URL contains one of these fragments. */
  urlIncludes?: string | string[];
  /** Shown while no matching computation is registered (e.g. layout work). */
  fallback?: ReactNode;
  className?: string;
};

/**
 * Inline progress for the computations a component is waiting on, with a
 * Cancel button. Drop it into a component's loading state; it falls back to
 * `fallback` (default: a spinner) while the request has not been registered
 * yet or the remaining work is client-side.
 */
export default function ComputationStatus({ fileId, urlIncludes, fallback, className = "" }: Props) {
  const jobs = useComputationStore((s) => s.jobs);
  const list = selectComputations(jobs, { fileId, urlIncludes });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (list.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [list.length]);

  if (list.length === 0) {
    return (
      <div className={`flex items-center justify-center gap-2 text-sm text-muted-foreground ${className}`}>
        {fallback ?? (
          <>
            <Loader2 size={16} className="animate-spin" />
            <span>Computing…</span>
          </>
        )}
      </div>
    );
  }
  return (
    <div
      data-testid="computation-status"
      className={`mx-auto flex w-full max-w-sm flex-col gap-3 rounded-md border bg-card/95 p-3 text-card-foreground shadow-sm ${className}`}
    >
      {list.map((job) => (
        <ComputationRow key={job.id} job={job} now={now} compact />
      ))}
    </div>
  );
}
