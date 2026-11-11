import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import { SelectedFileContext } from "./SelectedFileContext";

export type AnalysisComponent =
  | "processArea"
  | "ocdfg"
  | "variants"
  | "dottedChart"
  | "occn"
  | "ocPetriNet"
  | "totemMiner"
  | "sqlQuery"
  | "orgaMining";
export type ConformanceComponent = "totem" | "occn" | "ocpnReplay" | "ocAlignment";

export type EditorComponent = "totem" | "occn" | "ocpn" | "ocdfg" | "ocel";

export type ViewMode =
  | { type: "overview" }
  | { type: "modelAssets" }
  | { type: "imageAssets" }
  | { type: "queryAssets"; openAssetId?: number }
  | { type: "analysis"; component: AnalysisComponent }
  | { type: "conformance"; component: ConformanceComponent; assetId?: number }
  | { type: "editor"; component: EditorComponent; openAssetId?: number }
  | { type: "playout" }
  | { type: "dashboard"; id: number };

/**
 * Veto over a pending view change. Return true to let it through, false to
 * block it — a blocking guard is expected to ask the user and re-issue the
 * navigation itself once they agree. Used by the dashboard's edit mode so
 * unsaved layout changes are not dropped silently.
 */
export type NavigationGuard = (next: ViewMode) => boolean;

/**
 * `force` skips the navigation guard. For moves the user cannot be asked
 * about because the view they are on has ceased to exist — deleting the
 * open dashboard, say; there is nothing left to go back and save.
 */
export type SetViewModeOptions = { force?: boolean };

type DashboardContextType = {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode, options?: SetViewModeOptions) => void;
  /** Install the guard, or pass null to remove it. Only one can be active. */
  registerNavigationGuard?: (guard: NavigationGuard | null) => void;
  /**
   * Install a check for unsaved dashboard edits, or pass null to remove it.
   * Separate from the guard, which also *asks* the user: some callers only
   * need to know, e.g. an export that reads the last saved layout.
   */
  registerUnsavedChangesProbe?: (probe: (() => boolean) | null) => void;
  /** Whether the open dashboard has edits that are not saved yet. */
  hasUnsavedChanges?: () => boolean;
};

// eslint-disable-next-line react-refresh/only-export-components
export const DashboardContext = createContext<DashboardContextType>({
  viewMode: { type: "overview" },
  setViewMode: () => {},
  registerNavigationGuard: () => {},
  registerUnsavedChangesProbe: () => {},
  hasUnsavedChanges: () => false,
});

export const DashboardProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [viewMode, setViewModeState] = useState<ViewMode>({ type: "overview" });
  const navigate = useNavigate();
  const navigationGuard = useRef<NavigationGuard | null>(null);
  const unsavedChangesProbe = useRef<(() => boolean) | null>(null);

  // Every view but the overview belongs to the project it was opened from: a
  // dashboard of one project is not in another's sidebar and its widgets would
  // compute against the wrong log, and the asset ids carried by the model,
  // query, conformance and editor views are project-scoped just the same. So
  // changing the open event log drops the app back to the overview.
  //
  // Keyed on the id rather than the object: renaming the open project hands
  // back a fresh object for the same log (`team-switcher.tsx`), and that must
  // not eject the user from what they are looking at. Editors keep their
  // unsaved models across the unmount via `editors/shared/sessionCache.ts`.
  const { selectedFile } = useContext(SelectedFileContext);
  const openFileId = selectedFile?.id ?? null;
  const lastOpenFileId = useRef(openFileId);

  useEffect(() => {
    if (lastOpenFileId.current === openFileId) return;
    lastOpenFileId.current = openFileId;
    // `setViewModeState`, not `setViewMode`: navigating would throw the user
    // off the start page while they are still choosing which project to open,
    // and the navigation guard defends a view whose project has just been left.
    setViewModeState({ type: "overview" });
  }, [openFileId]);

  const registerNavigationGuard = useCallback(
    (guard: NavigationGuard | null) => {
      navigationGuard.current = guard;
    },
    []
  );

  const registerUnsavedChangesProbe = useCallback(
    (probe: (() => boolean) | null) => {
      unsavedChangesProbe.current = probe;
    },
    []
  );

  const hasUnsavedChanges = useCallback(
    () => unsavedChangesProbe.current?.() ?? false,
    []
  );

  // Selecting any view from the navbar also navigates to the main process
  // view. This ensures full-page routes like Settings close automatically
  // when a navbar item is clicked. Navigating to the current route is a
  // no-op, so this is safe to call unconditionally.
  const setViewMode = useCallback(
    (mode: ViewMode, options?: SetViewModeOptions) => {
      if (
        !options?.force &&
        navigationGuard.current &&
        !navigationGuard.current(mode)
      ) {
        return;
      }
      setViewModeState(mode);
      navigate("/overview");
    },
    [navigate]
  );

  return (
    <DashboardContext.Provider
      value={{
        viewMode,
        setViewMode,
        registerNavigationGuard,
        registerUnsavedChangesProbe,
        hasUnsavedChanges,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
};
