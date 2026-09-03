import React, { useEffect, useState } from "react";
import type { TourId } from "./tourIds";

export interface HighlighterProps {
  tourId: TourId | null;
  label: string;
  onNext: () => void;
  onPrev?: () => void;
  onSkip: () => void;
  currentIndex?: number;
  totalSteps?: number;
  isLastStep: boolean;
  showNav: boolean;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

export function findTourElement(tourId: TourId | string | null): HTMLElement | null {
  if (!tourId) return null;
  // 1. Direct data-tour-id lookup
  let el = document.querySelector<HTMLElement>(`[data-tour-id="${tourId}"]`);
  if (el) return el;

  // 2. Alias: 'file-selector' -> top-left project switcher
  if (tourId === "file-selector" || tourId === "file_selector") {
    el = document.querySelector<HTMLElement>(`[data-tour-id="project-switcher"]`);
    if (el) return el;
    el = document.querySelector<HTMLElement>(`[data-tour-id="nav-project"]`);
    if (el) return el;
  }

  // 3. Alias: 'project-switcher' -> 'file-selector'
  if (tourId === "project-switcher" || tourId === "project_switcher") {
    el = document.querySelector<HTMLElement>(`[data-tour-id="file-selector"]`);
    if (el) return el;
  }

  return null;
}

export function Highlighter({
  tourId,
  label,
  onNext,
  onPrev,
  onSkip,
  currentIndex = 0,
  totalSteps = 1,
  isLastStep,
  showNav,
}: HighlighterProps) {
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);

  // 1. Position tracking
  useEffect(() => {
    if (!showNav || !tourId) {
      setTargetRect(null);
      return;
    }

    const updatePosition = () => {
      const el = findTourElement(tourId);
      if (el) {
        const rect = el.getBoundingClientRect();
        setTargetRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
          right: rect.right,
        });
        el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      } else {
        setTargetRect(null);
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    const timer = setTimeout(updatePosition, 100);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      clearTimeout(timer);
    };
  }, [showNav, tourId]);

  // 2. Interactive Click Recording: Detect real user clicks on the target element
  useEffect(() => {
    if (!showNav || !tourId) return;

    const handlePointerDown = (e: MouseEvent | PointerEvent) => {
      const el = findTourElement(tourId);
      if (!el) return;

      // Check if user clicked the highlighted element or inside it
      if (el === e.target || el.contains(e.target as Node)) {
        // If there is a next step, smoothly advance after action opens
        // If it's the final step, stay visible so user can complete action and click "Finish Tour"
        if (!isLastStep) {
          setTimeout(() => {
            onNext();
          }, 600);
        }
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    };
  }, [showNav, tourId, onNext, isLastStep]);

  if (!showNav || !tourId) return null;

  return (
    <div
      data-testid="tour-highlighter"
      className="fixed inset-0 z-50 pointer-events-none transition-all duration-200"
    >
      {/* Target element spotlight frame - non-blocking glowing highlight ring */}
      {targetRect && (
        <div
          data-testid="tour-spotlight"
          className="absolute z-20 rounded-md ring-4 ring-primary ring-offset-2 ring-offset-background shadow-[0_0_25px_rgba(59,130,246,0.5)] transition-all duration-300 animate-pulse pointer-events-none"
          style={{
            top: `${Math.max(0, targetRect.top - 4)}px`,
            left: `${Math.max(0, targetRect.left - 4)}px`,
            width: `${targetRect.width + 8}px`,
            height: `${targetRect.height + 8}px`,
          }}
        />
      )}

      {/* Tour Callout Card */}
      <div
        className="fixed z-20 pointer-events-auto flex items-center justify-center p-4"
        style={
          targetRect
            ? {
                top: `${Math.min(window.innerHeight - 180, Math.max(20, targetRect.bottom + 16))}px`,
                left: `${Math.min(window.innerWidth - 360, Math.max(20, targetRect.left))}px`,
              }
            : {
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
              }
        }
      >
        <div className="bg-popover text-popover-foreground p-4 rounded-lg shadow-2xl border max-w-sm w-88 bg-background/95 backdrop-blur-md">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/20 text-primary text-xs font-bold">
                ★
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Teach Mode Guide
              </span>
            </div>
            {totalSteps > 1 && (
              <span className="text-[11px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                Step {currentIndex + 1} of {totalSteps}
              </span>
            )}
          </div>
          <p className="text-sm font-medium mb-3 leading-relaxed">{label}</p>
          <div className="text-[11px] text-primary/80 font-medium flex items-center gap-1 mb-3 bg-primary/5 px-2 py-1 rounded border border-primary/20">
            <span>👉</span>
            <span>Click the highlighted element on screen to continue</span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSkip}
                className="px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip
              </button>
              {currentIndex > 0 && onPrev && (
                <button
                  type="button"
                  onClick={onPrev}
                  className="px-2.5 py-1 text-xs font-medium border rounded-md hover:bg-muted transition-colors"
                >
                  ← Back
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={onNext}
              className="px-3.5 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-md shadow hover:opacity-90 active:scale-95 transition-all"
            >
              {isLastStep ? "Finish Tour" : "Next Step →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

