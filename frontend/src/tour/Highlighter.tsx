import React from "react";
import type { TourId } from "./tourIds";

export interface HighlighterProps {
  tourId: TourId | null;
  label: string;
  onNext: () => void;
  onSkip: () => void;
  isLastStep: boolean;
  showNav: boolean;
}

export function Highlighter({
  tourId,
  label,
  onNext,
  onSkip,
  isLastStep,
  showNav,
}: HighlighterProps) {
  if (!showNav || !tourId) return null;

  return (
    <div
      data-testid="tour-highlighter"
      className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-black/30"
    >
      <div className="pointer-events-auto bg-popover text-popover-foreground p-4 rounded-lg shadow-xl border max-w-sm">
        <p className="text-sm font-medium mb-3">{label}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onSkip}
            className="px-2 py-1 text-xs text-muted-foreground hover:underline"
          >
            Skip
          </button>
          <button
            onClick={onNext}
            className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90"
          >
            {isLastStep ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
