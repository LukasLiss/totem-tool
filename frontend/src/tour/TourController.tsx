import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TourId, TourStep } from "./tourIds";
import { Highlighter } from "./Highlighter";

interface TourState {
  active: boolean;
  steps: TourStep[];
  currentIndex: number;
  currentTourId: TourId | null;
  currentLabel: string;
  isLastStep: boolean;
}

interface TourControllerContextValue {
  state: TourState;
  startTour: (steps: TourStep[]) => void;
  nextStep: () => void;
  skipTour: () => void;
}

const TourControllerContext = createContext<TourControllerContextValue | null>(
  null
);

export function useTourController(): TourControllerContextValue {
  const ctx = useContext(TourControllerContext);
  if (!ctx) throw new Error("useTourController must be used within TourController");
  return ctx;
}

export function useOptionalTourController(): TourControllerContextValue | null {
  return useContext(TourControllerContext);
}

export const useTour = useTourController;

const EMPTY_STATE: TourState = {
  active: false,
  steps: [],
  currentIndex: 0,
  currentTourId: null,
  currentLabel: "",
  isLastStep: true,
};

interface TourControllerProps {
  children: React.ReactNode;
}

export function TourController({ children }: TourControllerProps) {
  const [state, setState] = useState<TourState>(EMPTY_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  const nextStep = useCallback(() => {
    setState((prev) => {
      if (!prev.active) return prev;
      const nextIdx = prev.currentIndex + 1;
      if (nextIdx >= prev.steps.length) {
        // Tour complete
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("agent:tourComplete"));
        }
        return EMPTY_STATE;
      }
      return {
        ...prev,
        currentIndex: nextIdx,
        currentTourId: prev.steps[nextIdx].tour_id,
        currentLabel: prev.steps[nextIdx].label,
        isLastStep: nextIdx === prev.steps.length - 1,
      };
    });
  }, []);

  const prevStep = useCallback(() => {
    setState((prev) => {
      if (!prev.active || prev.currentIndex <= 0) return prev;
      const prevIdx = prev.currentIndex - 1;
      return {
        ...prev,
        currentIndex: prevIdx,
        currentTourId: prev.steps[prevIdx].tour_id,
        currentLabel: prev.steps[prevIdx].label,
        isLastStep: false,
      };
    });
  }, []);

  const skipTour = useCallback(() => {
    setState(EMPTY_STATE);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("agent:tourComplete"));
    }
  }, []);

  const startTour = useCallback(
    (steps: TourStep[]) => {
      if (steps.length === 0) return;
      setState({
        active: true,
        steps,
        currentIndex: 0,
        currentTourId: steps[0].tour_id,
        currentLabel: steps[0].label,
        isLastStep: steps.length === 1,
      });
    },
    []
  );

  const value = useMemo<TourControllerContextValue>(
    () => ({ state, startTour, nextStep, skipTour }),
    [state, startTour, nextStep, skipTour]
  );

  return (
    <TourControllerContext.Provider value={value}>
      {children}
      <Highlighter
        tourId={state.currentTourId}
        label={state.currentLabel}
        onNext={nextStep}
        onPrev={prevStep}
        onSkip={skipTour}
        currentIndex={state.currentIndex}
        totalSteps={state.steps.length}
        isLastStep={state.isLastStep}
        showNav={state.active}
      />
    </TourControllerContext.Provider>
  );
}
