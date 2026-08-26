import type {
  OCCNConformanceResponse,
  OCCNReplayStatus,
} from "@/api/occnConformanceApi";

export type OCCNAggregateOutcome =
  | "fitting"
  | "non_fitting"
  | "partial"
  | "inconclusive"
  | "empty";

export interface OCCNAggregatePresentation {
  outcome: OCCNAggregateOutcome;
  label: string;
  description: string;
}

export const OCCN_REPLAY_STATUS_LABELS: Record<OCCNReplayStatus, string> = {
  fitting: "Fitting",
  non_fitting: "Non-fitting",
  inconclusive: "Inconclusive",
};

export function getOccnAggregatePresentation(
  result: OCCNConformanceResponse
): OCCNAggregatePresentation {
  if (result.total_units === 0) {
    return {
      outcome: "empty",
      label: "No replay units",
      description: "The selected event log did not produce any replay units.",
    };
  }

  if (result.non_fitting_units > 0) {
    return {
      outcome: "non_fitting",
      label:
        result.inconclusive_units > 0
          ? "Deviations found (partial)"
          : "Deviations found",
      description:
        result.inconclusive_units > 0
          ? "At least one replay unit is non-fitting, and some units remain inconclusive."
          : "At least one replay unit cannot be replayed by the selected OCCN model.",
    };
  }

  if (result.inconclusive_units === result.total_units) {
    return {
      outcome: "inconclusive",
      label: "Inconclusive",
      description:
        "Every replay unit reached a search limit before an outcome was proven.",
    };
  }

  if (result.inconclusive_units > 0) {
    return {
      outcome: "partial",
      label: "Partial result",
      description:
        "All conclusive replay units are fitting, but some units remain inconclusive.",
    };
  }

  return {
    outcome: "fitting",
    label: "Fitting",
    description: "Every replay unit can be replayed by the selected OCCN model.",
  };
}

export function formatOccnRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Not available";

  const percentage = value * 100;
  const digits = Number.isInteger(percentage) ? 0 : 1;
  return `${percentage.toFixed(digits)}%`;
}
