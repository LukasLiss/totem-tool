import { create } from "zustand";

/** One process area as drawn by the Process Area component. */
export type ProcessAreaSnapshot = {
  id: string;
  level: number;
  /** Object types joined for display, e.g. "order & item". */
  label: string;
  objectTypes: string[];
  /**
   * Activities the backend assigned to this area: every activity of the
   * area's object types that is not already claimed by a lower area.
   */
  activities: string[];
};

/** The process areas most recently computed for one event log. */
export type ProcessAreasSnapshot = {
  fileId: number;
  algorithm: string;
  /** True when the areas were computed on the globally filtered log. */
  filtered: boolean;
  areas: ProcessAreaSnapshot[];
  /** Every activity an object type takes part in. */
  objectTypeToActivities: Record<string, string[]>;
  computedAt: number;
};

type ProcessAreaStore = {
  byFile: Record<number, ProcessAreasSnapshot>;
  publish: (snapshot: Omit<ProcessAreasSnapshot, "computedAt">) => void;
  forget: (fileId: number) => void;
};

/**
 * Process areas computed by the Process Area component, keyed by event log.
 *
 * Other components (the Variants Explorer's resource-aware mode) can offer
 * "the process areas you already computed" without recomputing them and
 * without the two components knowing about each other.
 */
export const useProcessAreaStore = create<ProcessAreaStore>((set) => ({
  byFile: {},
  publish: (snapshot) =>
    set((state) => ({
      byFile: {
        ...state.byFile,
        [snapshot.fileId]: { ...snapshot, computedAt: Date.now() },
      },
    })),
  forget: (fileId) =>
    set((state) => {
      const next = { ...state.byFile };
      delete next[fileId];
      return { byFile: next };
    }),
}));

export function useProcessAreasForFile(
  fileId: number | string | null | undefined,
): ProcessAreasSnapshot | null {
  const key = Number(fileId);
  return useProcessAreaStore((state) =>
    Number.isFinite(key) && key > 0 ? state.byFile[key] ?? null : null,
  );
}
