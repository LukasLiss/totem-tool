// Process-area algorithm/params config, split out of TotemVisualizer.tsx so
// that file exports only the component — mixing these consts/types/function
// in with it trips react-refresh/only-export-components (Fast Refresh can't
// preserve state across a hot reload of a module whose exports aren't all
// components).

/**
 * Which engine decides the object-type hierarchy.
 *
 * - `mlpa`      — temporal relations only (Liss & van der Aalst, BPM 2025).
 * - `advanced`  — the three resource indicators of Schlegelmilch's thesis
 *                 section 4.1, tunable through {@link ProcessAreaParams}.
 *
 * Both endpoints return the same payload, so switching changes the URL and
 * nothing else in the render path.
 */
export type ProcessAreaAlgorithm = 'mlpa' | 'advanced';

/**
 * Parameters of the advanced algorithm.
 *
 * The weights decide how much each indicator contributes. `alpha` and `beta`
 * balance the two halves of the ILP objective, and follow the **thesis**
 * convention: `alpha` weights the resource force (separation), `beta` the
 * attractive force (cohesion). The reference implementation names them the
 * other way round; getting this backwards makes both sliders feel inverted.
 */
export type ProcessAreaParams = {
  wTemporal: number;
  wCardinality: number;
  wDivergence: number;
  alpha: number;
  beta: number;
};

export const DEFAULT_PROCESS_AREA_ALGORITHM: ProcessAreaAlgorithm = 'advanced';

export const DEFAULT_PROCESS_AREA_PARAMS: ProcessAreaParams = {
  wTemporal: 1,
  wCardinality: 1,
  wDivergence: 1,
  alpha: 1,
  beta: 1,
};

export const PROCESS_AREA_ALGORITHM_LABELS: Record<ProcessAreaAlgorithm, string> = {
  mlpa: 'MLPA (temporal)',
  advanced: 'Advanced (resource indicators)',
};

/**
 * Slider bounds. The lower bounds come from the thesis, the upper ones from how
 * the result actually responds — the maths bounds none of these above.
 *
 * **Weights** may be zero: Def. 4.1.11 takes `w_i ∈ ℝ≥0`, and a zero weight
 * simply drops that indicator. They are normalised by their sum, so only their
 * ratios matter and `0..2` around a default of `1` reaches every relative
 * weighting.
 *
 * **α and β may not.** Def. 4.1.12 takes them from `ℝ⁺`, strictly positive, and
 * the degenerate cases show why: at `α = 0` nothing separates the object types
 * and the whole log collapses onto one layer; at `β = 0` nothing holds peers
 * together. Neither is a hierarchy. The sliders therefore start at `0.1`.
 *
 * Their upper bound is `10`: only the ratio α/β matters — scaling both leaves
 * the ILP's argmin unchanged — so `0.1..10` spans ratios from 1:100 to 100:1.
 * Sweeping α against β = 1, container-logistics settles by 1.5,
 * order-management by 6 and p2p by 4. Only p2p moves again past 25, and by then
 * the resource force has drowned out cohesion entirely.
 */
export const PROCESS_AREA_PARAM_RANGES: Record<
  keyof ProcessAreaParams,
  { min: number; max: number; step: number }
> = {
  wTemporal: { min: 0, max: 2, step: 0.05 },
  wCardinality: { min: 0, max: 2, step: 0.05 },
  wDivergence: { min: 0, max: 2, step: 0.05 },
  alpha: { min: 0.1, max: 10, step: 0.1 },
  beta: { min: 0.1, max: 10, step: 0.1 },
};

/** Pull a value into its slider's range. */
export function clampProcessAreaParam(key: keyof ProcessAreaParams, value: number): number {
  const { min, max } = PROCESS_AREA_PARAM_RANGES[key];
  if (!Number.isFinite(value)) return DEFAULT_PROCESS_AREA_PARAMS[key];
  return Math.min(max, Math.max(min, value));
}

/**
 * Clamp a whole parameter set. Persisted dashboards may hold an α or β of `0`
 * from before the lower bound existed; those must land on `0.1` rather than
 * leaving the slider stuck below its own minimum.
 */
export function clampProcessAreaParams(
  params: Partial<ProcessAreaParams> | undefined,
): ProcessAreaParams {
  const merged = { ...DEFAULT_PROCESS_AREA_PARAMS, ...params };
  return (Object.keys(DEFAULT_PROCESS_AREA_PARAMS) as Array<keyof ProcessAreaParams>).reduce(
    (result, key) => {
      result[key] = clampProcessAreaParam(key, merged[key]);
      return result;
    },
    {} as ProcessAreaParams,
  );
}
