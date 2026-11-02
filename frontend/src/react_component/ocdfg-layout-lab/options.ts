/**
 * The option catalogue of the layout lab: every swappable aspect with its
 * variants, the defaults and a few hand-picked presets.
 */
import type { LayoutOptions } from './types';

export interface Choice<V extends string = string> {
  value: V;
  label: string;
  hint: string;
}

/** A selectable aspect (one option key with an enumerated set of values). */
export interface Aspect {
  key: keyof LayoutOptions;
  label: string;
  group: AspectGroup;
  choices: Choice[];
}

export type AspectGroup = 'Structure' | 'Object types' | 'Arcs' | 'Look';

export const ASPECTS: Aspect[] = [
  // ------------------------------------------------------------- Structure
  {
    key: 'direction',
    label: 'Flow direction',
    group: 'Structure',
    choices: [
      { value: 'TB', label: 'Top → bottom', hint: 'Main flow runs downwards.' },
      { value: 'LR', label: 'Left → right', hint: 'Main flow runs to the right.' },
      { value: 'BT', label: 'Bottom → top', hint: 'Main flow runs upwards.' },
      { value: 'RL', label: 'Right → left', hint: 'Main flow runs to the left.' },
    ],
  },
  {
    key: 'blockDetection',
    label: 'Block structure',
    group: 'Structure',
    choices: [
      { value: 'light', label: 'Light cuts on the DFG', hint: 'Inductive-miner cuts (×, →, ∧, ↺) detected on each type\'s DFG; sub-DFGs are projections, no log splitting. Instant.' },
      { value: 'im', label: 'Inductive miner (log)', hint: 'Full inductive miner per object type on the event log (backend, splits the log after every cut). Needs an event log.' },
      { value: 'none', label: 'None', hint: 'No block structure: every type is one column, parallel/choice branches are only spread apart to avoid overlaps.' },
    ],
  },
  {
    key: 'flowMethod',
    label: 'Main flow per type',
    group: 'Structure',
    choices: [
      { value: 'blocks', label: 'From block structure', hint: 'Order of the block tree: sequence order, loop body before redo. Back arcs are the loop-backs. Falls back to greedy FAS without blocks.' },
      { value: 'greedyFas', label: 'Greedy feedback arc set', hint: 'Eades–Lin–Smyth, weighted by frequency: the lightest set of arcs that breaks all cycles points backwards.' },
      { value: 'dfs', label: 'DFS from start', hint: 'Depth-first search from the start node, heaviest arcs first; arcs to an ancestor are loops.' },
      { value: 'springRank', label: 'SpringRank (least squares)', hint: 'Positions minimising Σ w·(p(target) − p(source) − 1)²; arcs pointing to a lower position are loops.' },
      { value: 'bfs', label: 'Distance from start', hint: 'Order by hop distance from the start node (ties by distance to the end).' },
    ],
  },
  {
    key: 'layering',
    label: 'Ranking (layers)',
    group: 'Structure',
    choices: [
      { value: 'compact', label: 'Compact (short arcs)', hint: 'Longest path, then nodes with slack move to the weighted median of their neighbours.' },
      { value: 'longestPath', label: 'Longest path (ASAP)', hint: 'Every activity as early as its predecessors allow.' },
      { value: 'longestPathBottom', label: 'Longest path (ALAP)', hint: 'Every activity as late as its successors allow.' },
    ],
  },
  {
    key: 'terminalPlacement',
    label: 'Start / end nodes',
    group: 'Structure',
    choices: [
      { value: 'laneTop', label: 'Aligned at lane top/bottom', hint: 'All starts on the first rank, all ends on the last, in their lane — like metro termini.' },
      { value: 'adjacent', label: 'Next to first/last activity', hint: 'Each start right before its first activities, each end right after its last.' },
    ],
  },
  // ---------------------------------------------------------- Object types
  {
    key: 'laneOrder',
    label: 'Order of object types',
    group: 'Object types',
    choices: [
      { value: 'minSpan', label: 'Min. arc span (≈ crossings)', hint: 'Permutation minimising the horizontal span of arcs between the types\' lanes (exhaustive up to 8 types).' },
      { value: 'similarity', label: 'Shared activities adjacent', hint: 'Types sharing many activities become neighbours (best Hamiltonian path on the similarity matrix).' },
      { value: 'centerLongest', label: 'Longest flow in the middle', hint: 'The type with the longest main flow in the centre, shorter ones alternately further out.' },
      { value: 'centerFrequent', label: 'Most frequent in the middle', hint: 'Centre-out by number of objects.' },
      { value: 'centerHub', label: 'Hub type in the middle', hint: 'Centre-out by number of activities shared with other types.' },
      { value: 'firstAppearance', label: 'By first appearance', hint: 'Types that start earlier in the flow are further left (staircase).' },
      { value: 'processAreas', label: 'By process areas', hint: 'Types of the same process area are neighbours, areas ordered by level. Needs an event log.' },
      { value: 'alphabetical', label: 'Alphabetical', hint: 'Baseline.' },
      { value: 'manual', label: 'Manual', hint: 'Use the arrows in the legend.' },
    ],
  },
  {
    key: 'crossPlacement',
    label: 'Cross-axis placement',
    group: 'Object types',
    choices: [
      { value: 'lanes', label: 'Strict lanes', hint: 'Each type keeps its own column; shared activities sit between their types.' },
      { value: 'lanesBarycenter', label: 'Lanes + barycentre', hint: 'Lane positions blended with the neighbours\' positions to reduce crossings.' },
      { value: 'sugiyama', label: 'Sugiyama (no lanes)', hint: 'Classic barycentre crossing minimisation, lanes only as start order.' },
    ],
  },
  {
    key: 'sharedPlacement',
    label: 'Shared activities',
    group: 'Object types',
    choices: [
      { value: 'centroid', label: 'Centre of their lanes', hint: 'Mean position over all types of the activity.' },
      { value: 'dominant', label: 'In the dominant lane', hint: 'Lane of the type with most events at the activity.' },
      { value: 'median', label: 'Median lane', hint: 'Median position over the types of the activity.' },
    ],
  },
  {
    key: 'branchPlacement',
    label: 'Choice / parallel branches',
    group: 'Object types',
    choices: [
      { value: 'mainStraight', label: 'Main branch straight', hint: 'The most frequent branch stays on the lane axis, others alternate to the sides.' },
      { value: 'centered', label: 'Symmetric', hint: 'Branches spread symmetrically around the lane axis.' },
      { value: 'none', label: 'Ignore blocks', hint: 'All activities on the lane axis.' },
    ],
  },
  {
    key: 'loopSide',
    label: 'Loops break out to',
    group: 'Object types',
    choices: [
      { value: 'right', label: 'Right side', hint: 'Redo parts and loop-back channels on the right of the flow.' },
      { value: 'left', label: 'Left side', hint: 'Redo parts and loop-back channels on the left of the flow.' },
      { value: 'outer', label: 'Outer side', hint: 'Away from the middle of the drawing.' },
      { value: 'inner', label: 'Inner side', hint: 'Towards the middle of the drawing.' },
    ],
  },
  // ------------------------------------------------------------------ Arcs
  {
    key: 'edgeStyle',
    label: 'Arc routing',
    group: 'Arcs',
    choices: [
      { value: 'bezier', label: 'Flow curves', hint: 'Smooth S-curves with tangents along the flow.' },
      { value: 'orthogonal', label: 'Orthogonal', hint: 'Horizontal/vertical segments with rounded corners; horizontal parts get their own tracks.' },
      { value: 'octilinear', label: 'Subway (45°)', hint: 'Vertical runs with 45° diagonals, like a metro map.' },
      { value: 'polyline', label: 'Polyline', hint: 'Straight segments through the layers (vertical inside a layer).' },
      { value: 'spline', label: 'Spline', hint: 'Catmull-Rom spline through the layer crossing points.' },
      { value: 'straight', label: 'Straight lines', hint: 'Direct line from port to port, ignoring obstacles.' },
    ],
  },
  {
    key: 'backArcStyle',
    label: 'Loop-back arcs',
    group: 'Arcs',
    choices: [
      { value: 'sideChannel', label: 'Side channel', hint: 'Leave the flow sideways, run upwards in a reserved channel, nested loops further out.' },
      { value: 'curve', label: 'Side curve', hint: 'One curve bulging to the side.' },
      { value: 'reversed', label: 'Through the layers', hint: 'Routed like forward arcs, just upwards (classic Sugiyama).' },
    ],
  },
  {
    key: 'portMode',
    label: 'Where arcs attach',
    group: 'Arcs',
    choices: [
      { value: 'flowAndSides', label: 'Flow sides + loops on sides', hint: 'Forward arcs enter on top and leave at the bottom; loops use the left/right sides.' },
      { value: 'flowOnly', label: 'Top in, bottom out only', hint: 'Every arc enters on top and leaves at the bottom, loops wrap around.' },
      { value: 'nearest', label: 'Nearest side', hint: 'The side facing the other end of the arc.' },
      { value: 'center', label: 'Shortest path (center)', hint: 'Aim at the node centre, cut at the border.' },
    ],
  },
  {
    key: 'portSpread',
    label: 'Ports on a side',
    group: 'Arcs',
    choices: [
      { value: 'distributed', label: 'Distributed', hint: 'Every arc gets its own port, sorted to avoid crossings.' },
      { value: 'byType', label: 'One port per type', hint: 'Each object type has a fixed track through every node.' },
      { value: 'single', label: 'One port per side', hint: 'All arcs meet in the middle of the side.' },
    ],
  },
  {
    key: 'bundling',
    label: 'Arcs of several types',
    group: 'Arcs',
    choices: [
      { value: 'highway', label: 'Highway', hint: 'Arcs between the same activities travel together as a tight band.' },
      { value: 'separate', label: 'Separate', hint: 'Every arc is routed on its own.' },
      { value: 'fanned', label: 'Fanned', hint: 'Shared endpoints, bulging apart in the middle.' },
      { value: 'merged', label: 'Merged (striped)', hint: 'One line, striped in the colours of all its types.' },
    ],
  },
  {
    key: 'selfLoopStyle',
    label: 'Self loops',
    group: 'Arcs',
    choices: [
      { value: 'cornerRing', label: 'Ring at a corner', hint: 'Small ring on the node\'s corner, one per type.' },
      { value: 'sideLoop', label: 'Loop on the side', hint: 'Teardrop leaving and re-entering the side.' },
      { value: 'badge', label: 'Badge', hint: '↻ badge with the count, no line.' },
      { value: 'hidden', label: 'Hidden', hint: 'Not drawn.' },
    ],
  },
  {
    key: 'parallelArcs',
    label: 'Arcs inside parallel blocks',
    group: 'Arcs',
    choices: [
      { value: 'dimmed', label: 'Dimmed', hint: 'Interleaving arcs between parallel branches are drawn faint and dashed.' },
      { value: 'normal', label: 'Normal', hint: 'Drawn like every other arc.' },
      { value: 'hidden', label: 'Hidden', hint: 'Not drawn at all.' },
    ],
  },
  {
    key: 'widthScale',
    label: 'Arc width',
    group: 'Arcs',
    choices: [
      { value: 'sqrt', label: 'Square root', hint: 'Width ∝ √frequency.' },
      { value: 'log', label: 'Logarithmic', hint: 'Width ∝ log(frequency).' },
      { value: 'linear', label: 'Linear', hint: 'Width ∝ frequency.' },
      { value: 'rank', label: 'Quantile', hint: 'Width by rank of the frequency.' },
      { value: 'constant', label: 'Constant', hint: 'Every arc has the same width.' },
    ],
  },
  {
    key: 'widthNormalization',
    label: 'Width relative to',
    group: 'Arcs',
    choices: [
      { value: 'perType', label: 'Own object type', hint: 'The heaviest arc of every type gets the maximal width.' },
      { value: 'global', label: 'All arcs', hint: 'One scale for all object types.' },
    ],
  },
  {
    key: 'arrowStyle',
    label: 'Arrow head',
    group: 'Arcs',
    choices: [
      { value: 'triangle', label: 'Triangle', hint: 'Filled triangle.' },
      { value: 'stealth', label: 'Stealth', hint: 'Barbed, concave triangle.' },
      { value: 'open', label: 'Open chevron', hint: 'Open V.' },
      { value: 'circle', label: 'Dot', hint: 'Dot at the target.' },
      { value: 'chevrons', label: 'Chevrons along the arc', hint: 'Small chevrons repeated along the arc, no head.' },
      { value: 'tapered', label: 'Tapered arc', hint: 'The arc gets thinner towards its target.' },
      { value: 'none', label: 'None', hint: 'Direction only from the layout.' },
    ],
  },
  // ------------------------------------------------------------------ Look
  {
    key: 'nodeStyle',
    label: 'Activity style',
    group: 'Look',
    choices: [
      { value: 'box', label: 'Box with type stripe', hint: 'White box, a stripe in the colours of its types.' },
      { value: 'station', label: 'Metro station', hint: 'Bold outline, dots for the lines stopping here.' },
      { value: 'gradient', label: 'Type gradient', hint: 'Filled with the colours of its types (current OC-DFG look).' },
      { value: 'pill', label: 'Pill', hint: 'Rounded, tinted with the dominant type.' },
      { value: 'minimal', label: 'Label only', hint: 'Just the label with type dots.' },
    ],
  },
  {
    key: 'terminalStyle',
    label: 'Start / end style',
    group: 'Look',
    choices: [
      { value: 'circle', label: 'Circle', hint: 'Coloured circle with ▶ / ■.' },
      { value: 'pill', label: 'Pill with name', hint: 'Coloured pill with the type name.' },
      { value: 'bar', label: 'Terminus bar', hint: 'Metro terminus bar.' },
      { value: 'dot', label: 'Small dot', hint: 'Small dot with label beside it.' },
    ],
  },
];

export const ASPECT_BY_KEY: Partial<Record<keyof LayoutOptions, Aspect>> = Object.fromEntries(
  ASPECTS.map((a) => [a.key, a]),
);

export const DEFAULT_OPTIONS: LayoutOptions = {
  direction: 'TB',
  flowMethod: 'blocks',
  blockDetection: 'light',
  blockNoise: 0.05,
  layering: 'compact',
  terminalPlacement: 'laneTop',
  laneOrder: 'minSpan',
  manualLaneOrder: [],
  crossPlacement: 'lanes',
  sharedPlacement: 'centroid',
  branchPlacement: 'mainStraight',
  loopSide: 'outer',
  edgeStyle: 'bezier',
  cornerRadius: 10,
  backArcStyle: 'sideChannel',
  portMode: 'flowAndSides',
  portSpread: 'distributed',
  mergePoints: false,
  bundling: 'highway',
  parallelArcs: 'dimmed',
  selfLoopStyle: 'cornerRing',
  widthScale: 'sqrt',
  widthNormalization: 'perType',
  minWidth: 1.2,
  maxWidth: 6,
  arrowStyle: 'triangle',
  arrowSize: 1,
  arcHalo: true,
  arcOpacity: 0.9,
  arcLabels: 'none',
  nodeStyle: 'box',
  terminalStyle: 'circle',
  fitNodeWidth: true,
  showFrequencies: true,
  rankGap: 56,
  nodeGap: 28,
  laneGap: 48,
  trackGap: 5,
  showLanes: true,
  showRanks: false,
  hiddenTypes: [],
  variantCoverage: 1,
  arcThreshold: 0,
};

export interface Preset {
  id: string;
  label: string;
  description: string;
  options: Partial<LayoutOptions>;
}

export const PRESETS: Preset[] = [
  {
    id: 'default',
    label: 'Lanes & blocks',
    description: 'The proposed default: one lane per type, block structure, loops in side channels, highways.',
    options: {},
  },
  {
    id: 'metro',
    label: 'Metro map',
    description: 'Subway routing, one track per type through every station, highways and terminus bars.',
    options: {
      edgeStyle: 'octilinear',
      portSpread: 'byType',
      bundling: 'highway',
      nodeStyle: 'station',
      terminalStyle: 'bar',
      widthScale: 'constant',
      minWidth: 3,
      maxWidth: 3,
      arrowStyle: 'chevrons',
      trackGap: 4,
      selfLoopStyle: 'sideLoop',
    },
  },
  {
    id: 'orthogonal',
    label: 'Engineering',
    description: 'Orthogonal arcs on their own tracks, top-in/bottom-out, merge points.',
    options: {
      edgeStyle: 'orthogonal',
      portMode: 'flowOnly',
      portSpread: 'byType',
      mergePoints: true,
      bundling: 'separate',
      arrowStyle: 'open',
      nodeStyle: 'box',
      widthScale: 'log',
    },
  },
  {
    id: 'classic',
    label: 'Classic Sugiyama',
    description: 'Baseline: no lanes, no blocks, back arcs through the layers.',
    options: {
      blockDetection: 'none',
      flowMethod: 'greedyFas',
      crossPlacement: 'sugiyama',
      backArcStyle: 'reversed',
      bundling: 'separate',
      portMode: 'center',
      edgeStyle: 'spline',
      nodeStyle: 'gradient',
      showLanes: false,
      layering: 'longestPath',
    },
  },
  {
    id: 'minimal',
    label: 'Minimal ink',
    description: 'Labels only, thin merged arcs, tapered direction.',
    options: {
      nodeStyle: 'minimal',
      terminalStyle: 'dot',
      bundling: 'merged',
      arrowStyle: 'tapered',
      widthScale: 'sqrt',
      minWidth: 1.5,
      maxWidth: 5,
      arcHalo: false,
      showLanes: false,
      selfLoopStyle: 'badge',
    },
  },
  {
    id: 'horizontal',
    label: 'Left to right',
    description: 'Horizontal flow with flow curves, loops breaking out on the outer side.',
    options: {
      direction: 'LR',
      edgeStyle: 'bezier',
      loopSide: 'outer',
      nodeStyle: 'pill',
      terminalStyle: 'pill',
    },
  },
];

export function withDefaults(partial: Partial<LayoutOptions> | null | undefined): LayoutOptions {
  const merged = { ...DEFAULT_OPTIONS, ...(partial ?? {}) } as LayoutOptions;
  // Drop unknown enum values (e.g. from an older saved config).
  for (const aspect of ASPECTS) {
    const value = merged[aspect.key] as unknown as string;
    if (!aspect.choices.some((c) => c.value === value)) {
      (merged as unknown as Record<string, unknown>)[aspect.key] = DEFAULT_OPTIONS[aspect.key];
    }
  }
  if (!Array.isArray(merged.hiddenTypes)) merged.hiddenTypes = [];
  if (!Array.isArray(merged.manualLaneOrder)) merged.manualLaneOrder = [];
  return merged;
}

/** A random but sensible combination for "surprise me". */
export function randomOptions(base: LayoutOptions, rng: () => number = Math.random): LayoutOptions {
  const next: LayoutOptions = { ...base };
  for (const aspect of ASPECTS) {
    if (aspect.key === 'direction' || aspect.key === 'laneOrder') continue;
    const pick = aspect.choices[Math.floor(rng() * aspect.choices.length)];
    (next as unknown as Record<string, unknown>)[aspect.key] = pick.value;
  }
  if (next.laneOrder === 'manual' || next.laneOrder === 'processAreas') next.laneOrder = 'minSpan';
  return next;
}
