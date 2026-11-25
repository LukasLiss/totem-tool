/**
 * Types of the OC-DFG Layout Lab.
 *
 * The lab lays out an object-centric directly-follows graph with a
 * configurable pipeline (main flow per object type → block structure →
 * ranks → lane order → cross placement → ports → routing) so the different
 * variants of every step can be compared interactively.
 *
 * All geometry inside the pipeline lives in "flow space": `f` runs along the
 * main flow direction (top → bottom for TB) and `c` across it. Only the very
 * last step maps flow space onto the screen for the selected direction.
 */

export type NodeKind = 'activity' | 'start' | 'end';

export interface LabNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Object types touching this node. Start/end nodes have exactly one. */
  types: string[];
  frequency: number;
}

export interface LabArc {
  id: string;
  source: string;
  target: string;
  /** The object type this directly-follows relation belongs to. */
  type: string;
  weight: number;
  /** Rank of the most frequent variant containing the arc (1 = most frequent). */
  variantRank?: number;
  avgLeadTime?: number | null;
}

export interface LabGraph {
  nodes: LabNode[];
  arcs: LabArc[];
  types: string[];
  /** Number of variants per object type, for the coverage slider. */
  variantCounts?: Record<string, number>;
}

/** JSON shape of a process tree discovered by the backend inductive miner. */
export interface ProcessTreeJson {
  operator: 'sequence' | 'xor' | 'parallel' | 'loop' | null;
  label: string | null;
  children: ProcessTreeJson[];
}

/** Block structure of one object type's DFG, inductive-miner style. */
export type Block =
  | { kind: 'leaf'; activity: string }
  | { kind: 'tau' }
  | { kind: 'seq' | 'xor' | 'and' | 'loop' | 'flower'; children: Block[] };

export type Pt = { x: number; y: number };

export type Side = 'in' | 'out' | 'left' | 'right';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type Direction = 'TB' | 'LR' | 'BT' | 'RL';
export type FlowMethod = 'blocks' | 'greedyFas' | 'dfs' | 'springRank' | 'bfs';
export type BlockDetection = 'none' | 'light' | 'im';
export type Layering = 'longestPath' | 'longestPathBottom' | 'compact';
export type TerminalPlacement = 'laneTop' | 'adjacent';
export type LaneOrder =
  | 'alphabetical'
  | 'minSpan'
  | 'similarity'
  | 'centerLongest'
  | 'centerFrequent'
  | 'centerHub'
  | 'firstAppearance'
  | 'processAreas'
  | 'manual';
export type CrossPlacement = 'lanes' | 'lanesBarycenter' | 'sugiyama';
export type SharedPlacement = 'centroid' | 'dominant' | 'median';
export type BranchPlacement = 'mainStraight' | 'centered' | 'none';
export type LoopSide = 'right' | 'left' | 'outer' | 'inner';
export type EdgeStyle = 'straight' | 'polyline' | 'orthogonal' | 'octilinear' | 'spline' | 'bezier';
export type BackArcStyle = 'sideChannel' | 'curve' | 'reversed';
export type PortMode = 'center' | 'flowOnly' | 'flowAndSides' | 'nearest';
export type PortSpread = 'distributed' | 'single' | 'byType';
export type Bundling = 'separate' | 'highway' | 'merged' | 'fanned';
export type SelfLoopStyle = 'cornerRing' | 'sideLoop' | 'badge' | 'hidden';
export type WidthScale = 'constant' | 'linear' | 'sqrt' | 'log' | 'rank';
export type WidthNormalization = 'global' | 'perType';
export type ArrowStyle = 'triangle' | 'open' | 'stealth' | 'circle' | 'chevrons' | 'tapered' | 'none';
export type NodeStyle = 'box' | 'gradient' | 'pill' | 'station' | 'minimal';
export type TerminalStyle = 'circle' | 'pill' | 'dot' | 'bar';
export type ParallelArcs = 'normal' | 'dimmed' | 'hidden';
export type ArcLabels = 'none' | 'frequency';

export interface LayoutOptions {
  // Structure
  direction: Direction;
  flowMethod: FlowMethod;
  blockDetection: BlockDetection;
  /** IMf-style noise threshold for the light cut detection (0..0.5). */
  blockNoise: number;
  layering: Layering;
  terminalPlacement: TerminalPlacement;
  // Object type arrangement
  laneOrder: LaneOrder;
  manualLaneOrder: string[];
  crossPlacement: CrossPlacement;
  sharedPlacement: SharedPlacement;
  branchPlacement: BranchPlacement;
  loopSide: LoopSide;
  // Arcs
  edgeStyle: EdgeStyle;
  cornerRadius: number;
  backArcStyle: BackArcStyle;
  portMode: PortMode;
  portSpread: PortSpread;
  mergePoints: boolean;
  bundling: Bundling;
  parallelArcs: ParallelArcs;
  selfLoopStyle: SelfLoopStyle;
  widthScale: WidthScale;
  widthNormalization: WidthNormalization;
  minWidth: number;
  maxWidth: number;
  arrowStyle: ArrowStyle;
  arrowSize: number;
  arcHalo: boolean;
  arcOpacity: number;
  arcLabels: ArcLabels;
  // Nodes
  nodeStyle: NodeStyle;
  terminalStyle: TerminalStyle;
  fitNodeWidth: boolean;
  showFrequencies: boolean;
  // Spacing
  rankGap: number;
  nodeGap: number;
  laneGap: number;
  trackGap: number;
  // Debug / overlays
  showLanes: boolean;
  showRanks: boolean;
  // Data
  hiddenTypes: string[];
  /** Share of each type's variants whose arcs are shown (0..1]. */
  variantCoverage: number;
  /** Hide arcs lighter than this share of their type's heaviest arc (0..1). */
  arcThreshold: number;
}

// ---------------------------------------------------------------------------
// Layout result (screen space)
// ---------------------------------------------------------------------------

export interface PlacedNode {
  id: string;
  label: string;
  kind: NodeKind;
  types: string[];
  frequency: number;
  /** Center on screen. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Object type of a start/end node. */
  objectType?: string;
}

export type ArcClass = 'forward' | 'back' | 'flat' | 'interleave' | 'self';

export interface RoutedArc {
  id: string;
  source: string;
  target: string;
  type: string;
  weight: number;
  cls: ArcClass;
  width: number;
  points: Pt[];
  /** Draw an arrowhead at the end of `points` (false when a merge trunk carries it). */
  arrow: boolean;
  /** Arcs drawn as one multi-coloured line ('merged' bundling) share an id. */
  mergedGroup?: { index: number; size: number; types: string[] };
  /** Size of the highway/bundle this arc belongs to. */
  bundleSize: number;
  avgLeadTime?: number | null;
  labelPos?: Pt;
}

export interface Trunk {
  type: string;
  /** The node whose port the trunk attaches to. */
  node: string;
  /** Ids of the arcs joined by this trunk. */
  arcs: string[];
  points: Pt[];
  width: number;
  arrow: boolean;
}

export type Junction = Pt & { type: string; node: string; arcs: string[] };

export interface SelfLoop {
  node: string;
  type: string;
  weight: number;
  width: number;
  style: SelfLoopStyle;
  /** Path for ring/side loops, already in screen space. */
  points: Pt[];
  /** Badge center for the badge style. */
  center: Pt;
  radius: number;
}

export interface LaneBand {
  type: string;
  /** Screen-space rectangle. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * The lane's title: anchor point (text-anchor `anchor`, vertically
   * centred) and the size of its box. It sits in a header area at the start
   * of the lane that no node reaches into.
   */
  label: { x: number; y: number; anchor: 'start' | 'middle' | 'end'; width: number; height: number };
}

export interface LayoutMetrics {
  crossings: number;
  overlaps: number;
  nodeHits: number;
  totalLength: number;
  bends: number;
  backArcs: number;
  width: number;
  height: number;
  ms: number;
}

export interface TypeSummary {
  type: string;
  lane: number;
  blockTree: string;
  activities: number;
  backArcs: number;
  interleaveArcs: number;
}

export interface LayoutResult {
  nodes: PlacedNode[];
  arcs: RoutedArc[];
  trunks: Trunk[];
  junctions: Junction[];
  selfLoops: SelfLoop[];
  lanes: LaneBand[];
  rankLines: Array<{ a: Pt; b: Pt }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  laneOrder: string[];
  typeSummaries: TypeSummary[];
  metrics: LayoutMetrics;
  notes: string[];
}

/** Data the layout can use beyond the DFG itself. */
export interface LayoutExtras {
  /** Process trees per object type from the backend inductive miner. */
  imTrees?: Record<string, ProcessTreeJson>;
  /** Process areas, ordered (each one a list of object types). */
  processAreas?: string[][];
}
