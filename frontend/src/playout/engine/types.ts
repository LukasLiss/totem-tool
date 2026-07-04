/**
 * Shared types of the object-centric playout engines (OCPN + OCCN).
 *
 * The "wide" playout enumerates complete process executions allowed by a
 * model, given a fixed number of objects per object type and a maximum
 * number of occurrences per activity. Executions that only differ by the
 * interleaving of independent events or by renaming objects of the same
 * type are the same *object-centric variant*; the engine counts and
 * returns variants, not raw firing sequences.
 */

/** One event of a process execution: an activity plus the bound objects. */
export type PlayoutEvent = {
  activity: string;
  /** Silent transitions and START_/END_ pseudo activities are invisible. */
  visible: boolean;
  /** Object ids per object type, sorted. */
  objects: Record<string, string[]>;
};

/** One object-centric variant (a canonical complete process execution). */
export type PlayoutVariant = {
  /** Visible events in canonical order with canonical object names. */
  events: PlayoutEvent[];
  /** Number of objects per type participating in visible events. */
  objectCounts: Record<string, number>;
};

export type PlayoutMode =
  /** Enumerate variants (dedup interleavings + object renaming). */
  | 'variants'
  /**
   * Count every complete binding/firing sequence without any pruning or
   * dedup. Mirrors totem_lib's occn_playout; used for parity tests.
   */
  | 'raw';

export type PlayoutConfig = {
  mode: PlayoutMode;
  /** Objects per object type for one process execution. */
  objectsPerType: Record<string, number>;
  /**
   * Max occurrences per budget key. Keys are activity labels; OCPN silent
   * transitions use their τ key (see budgetKey of the engine). Budget keys
   * missing from the map fall back to `defaultActivityLimit`.
   */
  activityLimits: Record<string, number>;
  defaultActivityLimit: number;
  /** Wall-clock budget; when exceeded the result is a lower bound. */
  timeoutMs: number;
  /** Max variants kept in memory (counting continues beyond it). */
  maxStoredVariants: number;
  /** Hard safety cap on visited search nodes. */
  maxStates: number;
  onProgress?: (p: PlayoutProgress) => void;
};

export type PlayoutProgress = {
  statesExplored: number;
  completedRuns: number;
  variantCount: number;
  elapsedMs: number;
};

export type PlayoutResult = {
  variants: PlayoutVariant[];
  /** Total distinct variants found (>= variants.length). */
  variantCount: number;
  /** Complete executions reached (canonical ones in 'variants' mode). */
  completedRuns: number;
  statesExplored: number;
  elapsedMs: number;
  /** True if the search space was fully explored within all limits. */
  exhaustive: boolean;
  timedOut: boolean;
  /** True if the state-cap was hit before the search finished. */
  stateCapHit: boolean;
  /**
   * True if variant dedup had to skip the full canonical minimization for
   * at least one execution (too many symmetric objects). The variant count
   * is then an upper bound of the true count (never an undercount).
   */
  approximateDedup: boolean;
  warnings: string[];
};

/**
 * One enabled step (a binding of an activity / a transition firing with a
 * concrete object binding) offered by an engine in the current state.
 */
export type PlayoutStep = {
  /**
   * Stable serialization of the step's visible identity: activity plus
   * bound objects. Used as the letter for trace-normal-form pruning; equal
   * letters imply equal events.
   */
  letter: string;
  /** All object ids bound by the step (for independence checks). */
  objectIds: string[];
  /** Which activity budget the step consumes. */
  budgetKey: string;
  event: PlayoutEvent;
  /** Applies the step to the engine state; returns the undo function. */
  apply: () => () => void;
};

/** State-exploration interface implemented by the OCPN and OCCN engines. */
export type PlayoutEngine = {
  /** Object ids per type in canonical (creation) order. */
  objects: Record<string, string[]>;
  /** Model-level warnings collected while preparing the engine. */
  warnings: string[];
  /**
   * Enabled steps in the current internal state. `usedObjects` contains
   * ids of objects that already participated in an applied step; engines
   * apply the fresh-object symmetry reduction against it unless raw mode
   * is requested.
   */
  enabledSteps: (usedObjects: ReadonlySet<string>, raw: boolean) => PlayoutStep[];
  /** True if the current state is a complete process execution. */
  isComplete: () => boolean;
  /**
   * Canonical serialization of the current state. Used to memoize the
   * completion count per (state, remaining budgets) in raw mode, exactly
   * like totem_lib's playout memoizes (state, activity_counts).
   */
  stateKey: () => string;
};
