import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { TourId } from "./tourIds";

const DISMISS_MS = 8_000;

interface HighlighterProps {
  tourId: TourId | null;
  label: string;
  onNext?: () => void;
  onSkip?: () => void;
  isLastStep?: boolean;
  showNav?: boolean;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getRect(tourId: TourId): Rect | null {
  const el = document.querySelector(`[data-tour-id="${tourId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function Highlighter({
  tourId,
  label,
  onNext,
  onSkip,
  isLastStep = false,
  showNav = false,
}: HighlighterProps) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve element rect and animate in
  useEffect(() => {
    if (!tourId) {
      setVisible(false);
      setRect(null);
      return;
    }

    const r = getRect(tourId);
    if (!r) {
      setVisible(false);
      setRect(null);
      return;
    }

    setRect(r);
    // Trigger entrance animation on next frame
    requestAnimationFrame(() => setVisible(true));

    // Auto-dismiss after DISMISS_MS
    timerRef.current = setTimeout(() => {
      setVisible(false);
    }, DISMISS_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [tourId]);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  if (!tourId || !rect) return null;

  const pad = 8;
  const tooltipWidth = 280;
  // Position tooltip to the right of the spotlight, or left if not enough space
  const spaceRight = window.innerWidth - (rect.left + rect.width + pad + tooltipWidth + 16);
  const tooltipLeft =
    spaceRight > 0
      ? rect.left + rect.width + pad + 16
      : Math.max(16, rect.left - tooltipWidth - 16);
  const tooltipTop = Math.max(16, rect.top);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] pointer-events-none"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 150ms ease-in-out" }}
      onClick={dismiss}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Spotlight cutout */}
      <div
        className="absolute rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
        style={{
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          transition: "all 200ms ease-in-out",
        }}
      />

      {/* Tooltip */}
      <div
        className="absolute pointer-events-auto bg-popover text-popover-foreground border rounded-lg shadow-lg px-4 py-3 max-w-[300px]"
        style={{
          top: tooltipTop,
          left: tooltipLeft,
          width: tooltipWidth,
          transition: "all 200ms ease-in-out",
        }}
      >
        <p className="text-sm font-medium leading-snug">{label}</p>
        {showNav && (
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                dismiss();
                onSkip?.();
              }}
            >
              Skip tour
            </button>
            <button
              className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded-md hover:bg-primary/90 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                dismiss();
                onNext?.();
              }}
            >
              {isLastStep ? "Done" : "Next"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
