import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  CircleX,
} from "lucide-react";

import type { OCCNConformanceResponse } from "@/api/occnConformanceApi";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import {
  formatOccnRatio,
  getOccnAggregatePresentation,
  type OCCNAggregateOutcome,
} from "./conformancePresentation";

export function OccnConformanceSummary({
  result,
}: {
  result: OCCNConformanceResponse;
}) {
  const presentation = getOccnAggregatePresentation(result);
  const Icon = OUTCOME_STYLES[presentation.outcome].icon;
  const metrics = [
    {
      label: "Fitness",
      value: formatOccnRatio(result.fitness),
    },
    {
      label: "Coverage",
      value:
        result.total_units === 0
          ? "Not applicable"
          : formatOccnRatio(result.coverage),
    },
    { label: "Replay units", value: result.total_units.toLocaleString() },
    { label: "Fitting", value: result.fitting_units.toLocaleString() },
    {
      label: "Non-fitting",
      value: result.non_fitting_units.toLocaleString(),
    },
    {
      label: "Inconclusive",
      value: result.inconclusive_units.toLocaleString(),
    },
  ];

  return (
    <section
      aria-labelledby="occn-result-summary-title"
      className="overflow-hidden rounded-md border bg-background"
    >
      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Icon
            className={cn(
              "mt-0.5 size-5 shrink-0",
              OUTCOME_STYLES[presentation.outcome].iconClassName
            )}
          />
          <div className="min-w-0">
            <h2 id="occn-result-summary-title" className="text-sm font-semibold">
              Conformance result
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {presentation.description}
            </p>
          </div>
        </div>
        <Badge
          variant={OUTCOME_STYLES[presentation.outcome].badgeVariant}
          className={OUTCOME_STYLES[presentation.outcome].badgeClassName}
        >
          {presentation.label}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric, index) => (
          <div
            key={metric.label}
            className={cn(
              "min-w-0 border-l-0 border-t-0 px-4 py-3 md:border-l-0 md:border-t-0 xl:border-l-0 xl:border-t-0",
              index % 2 !== 0 && "border-l",
              index >= 2 && "border-t",
              index % 3 !== 0 && "md:border-l",
              index >= 3 && "md:border-t",
              index > 0 && "xl:border-l"
            )}
          >
            <dt className="text-xs text-muted-foreground">{metric.label}</dt>
            <dd className="mt-1 truncate text-lg font-semibold tabular-nums">
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const OUTCOME_STYLES: Record<
  OCCNAggregateOutcome,
  {
    icon: typeof CheckCircle2;
    iconClassName: string;
    badgeVariant: "default" | "destructive" | "outline" | "secondary";
    badgeClassName?: string;
  }
> = {
  fitting: {
    icon: CheckCircle2,
    iconClassName: "text-emerald-600 dark:text-emerald-400",
    badgeVariant: "outline",
    badgeClassName:
      "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  },
  non_fitting: {
    icon: CircleX,
    iconClassName: "text-destructive",
    badgeVariant: "destructive",
  },
  partial: {
    icon: AlertTriangle,
    iconClassName: "text-amber-600 dark:text-amber-400",
    badgeVariant: "outline",
    badgeClassName:
      "border-amber-600/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  inconclusive: {
    icon: AlertTriangle,
    iconClassName: "text-amber-600 dark:text-amber-400",
    badgeVariant: "outline",
    badgeClassName:
      "border-amber-600/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  empty: {
    icon: CircleAlert,
    iconClassName: "text-muted-foreground",
    badgeVariant: "secondary",
  },
};

export default OccnConformanceSummary;
