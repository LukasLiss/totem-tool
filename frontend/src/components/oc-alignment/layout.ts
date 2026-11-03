/**
 * Graph layout for object-centric alignments.
 *
 * An alignment is a DAG of moves (Def. 5.9 of the thesis): two moves are
 * connected when they share an object that no move in between uses. The
 * layout is layered: every move sits one column right of its latest
 * predecessor, and the rows inside a column follow the predecessors'
 * rows (barycentre ordering) so the lanes of individual objects stay
 * straight as long as possible.
 */
import type { OCAlignmentMove } from "@/api/ocAlignmentApi";

export const NODE_WIDTH = 176;
/** Minimum height of one half (log / model part) of a move box. */
export const NODE_HALF_HEIGHT = 46;
export const NODE_HEIGHT = NODE_HALF_HEIGHT * 2;
/** Object chips: one line of chips, the label block above them, and a cap. */
export const CHIP_LINE_HEIGHT = 18;
const CHIP_LABEL_BLOCK = 24;
export const MAX_CHIP_LINES = 4;
const CHIP_AREA_WIDTH = NODE_WIDTH - 20; // box padding and border
const CHIP_GAP = 2;
const CHIP_MAX_WIDTH = 80;
const OVERFLOW_CHIP_WIDTH = 52;
export const COLUMN_GAP = 56;
export const ROW_GAP = 22;
export const PADDING = 16;

/** Visual vocabulary of the three move kinds (thesis, ch. 7). */
export const MOVE_STYLES = {
  sync: { label: "Synchronous move", border: "solid", color: "#059669", fill: "#ECFDF5" },
  log: { label: "Log move", border: "dashed", color: "#D97706", fill: "#FFFBEB" },
  model: { label: "Model move", border: "dotted", color: "#7C3AED", fill: "#F5F3FF" },
} as const;

/** Estimated rendered width of an object chip (10px font, 1px border, 4px padding). */
export function chipWidth(id: string): number {
  return Math.min(CHIP_MAX_WIDTH, Math.ceil(id.length * 6 + 12));
}

/**
 * How many chips fit in ``maxLines`` lines (greedy, like flex-wrap) and how
 * many lines they take. When not all fit, room is kept for a "+N" chip.
 */
export function packChips(ids: string[], maxLines = MAX_CHIP_LINES): { visible: number; lines: number } {
  const place = (count: number, extra: number) => {
    let lines = ids.length || extra ? 1 : 0;
    let x = 0;
    const widths = [...ids.slice(0, count).map(chipWidth), ...(extra ? [extra] : [])];
    for (const w of widths) {
      if (x > 0 && x + w > CHIP_AREA_WIDTH) {
        lines += 1;
        x = 0;
      }
      x += w + CHIP_GAP;
    }
    return lines;
  };
  if (place(ids.length, 0) <= maxLines) return { visible: ids.length, lines: place(ids.length, 0) };
  let visible = ids.length - 1;
  while (visible > 0 && place(visible, OVERFLOW_CHIP_WIDTH) > maxLines) visible -= 1;
  return { visible, lines: place(visible, OVERFLOW_CHIP_WIDTH) };
}

function objectIds(objects: Record<string, string[]>): string[] {
  return Object.values(objects ?? {}).flat();
}

/** Half-box height that fits the chips of every move (all boxes share it). */
export function halfHeightFor(moves: OCAlignmentMove[]): number {
  let lines = 1;
  for (const move of moves) {
    for (const objects of [move.log_objects, move.model_objects]) {
      lines = Math.max(lines, packChips(objectIds(objects)).lines);
    }
  }
  return Math.max(NODE_HALF_HEIGHT, CHIP_LABEL_BLOCK + lines * CHIP_LINE_HEIGHT + 4);
}

export function moveObjects(move: OCAlignmentMove): string[] {
  const seen = new Set<string>();
  for (const group of [move.log_objects, move.model_objects]) {
    for (const objs of Object.values(group ?? {})) objs.forEach((o) => seen.add(o));
  }
  return [...seen].sort();
}

export function isSilentModelMove(move: OCAlignmentMove): boolean {
  return move.kind === "model" && move.silent;
}

/** The moves to draw and their edges; silent moves are bridged when hidden. */
export function visibleAlignment(
  moves: OCAlignmentMove[],
  showSilentMoves: boolean,
): { moves: OCAlignmentMove[]; edges: [number, number][] } {
  const visible = showSilentMoves ? moves : moves.filter((m) => !isSilentModelMove(m));
  const last = new Map<string, number>();
  const edges = new Set<string>();
  const out: [number, number][] = [];
  visible.forEach((move, position) => {
    for (const obj of moveObjects(move)) {
      const previous = last.get(obj);
      if (previous !== undefined) {
        const key = `${previous}-${position}`;
        if (!edges.has(key)) {
          edges.add(key);
          out.push([previous, position]);
        }
      }
      last.set(obj, position);
    }
  });
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { moves: visible, edges: out };
}

export interface LaidOutNode {
  /** Position in the visible move list. */
  position: number;
  move: OCAlignmentMove;
  column: number;
  row: number;
  x: number;
  y: number;
}

export interface AlignmentLayout {
  /** Height of one half of every move box (fits the largest object set). */
  halfHeight: number;
  nodes: LaidOutNode[];
  edges: { from: LaidOutNode; to: LaidOutNode }[];
  width: number;
  height: number;
  columns: number;
  rows: number;
}

/** Layered layout of the (already filtered) alignment graph. */
export function layoutAlignment(
  moves: OCAlignmentMove[],
  edges: [number, number][],
): AlignmentLayout {
  const halfHeight = halfHeightFor(moves);
  const nodeHeight = halfHeight * 2;
  const predecessors: number[][] = moves.map(() => []);
  for (const [from, to] of edges) {
    if (from < moves.length && to < moves.length && from < to) predecessors[to].push(from);
  }
  // Edges always point forward in the move order, so one pass suffices.
  const column = moves.map(() => 0);
  moves.forEach((_, i) => {
    for (const p of predecessors[i]) column[i] = Math.max(column[i], column[p] + 1);
  });

  const columns = new Map<number, number[]>();
  column.forEach((c, i) => {
    if (!columns.has(c)) columns.set(c, []);
    columns.get(c)!.push(i);
  });
  const row = moves.map(() => 0);
  const columnIds = [...columns.keys()].sort((a, b) => a - b);
  for (const c of columnIds) {
    const members = columns.get(c)!;
    const keyed = members.map((i) => {
      const preds = predecessors[i];
      const key = preds.length ? preds.reduce((s, p) => s + row[p], 0) / preds.length : i;
      return { i, key };
    });
    keyed.sort((a, b) => a.key - b.key || a.i - b.i);
    // Rows are assigned greedily close to the barycentre, never overlapping.
    let next = 0;
    for (const { i, key } of keyed) {
      const wanted = Math.max(next, Math.round(key));
      row[i] = wanted;
      next = wanted + 1;
    }
  }

  const nodes: LaidOutNode[] = moves.map((move, i) => ({
    position: i,
    move,
    column: column[i],
    row: row[i],
    x: PADDING + column[i] * (NODE_WIDTH + COLUMN_GAP),
    y: PADDING + row[i] * (nodeHeight + ROW_GAP),
  }));
  const maxColumn = nodes.reduce((m, n) => Math.max(m, n.column), 0);
  const maxRow = nodes.reduce((m, n) => Math.max(m, n.row), 0);
  return {
    halfHeight,
    nodes,
    edges: edges
      .filter(([a, b]) => a < nodes.length && b < nodes.length)
      .map(([a, b]) => ({ from: nodes[a], to: nodes[b] })),
    width: nodes.length ? PADDING * 2 + (maxColumn + 1) * NODE_WIDTH + maxColumn * COLUMN_GAP : 0,
    height: nodes.length ? PADDING * 2 + (maxRow + 1) * nodeHeight + maxRow * ROW_GAP : 0,
    columns: nodes.length ? maxColumn + 1 : 0,
    rows: nodes.length ? maxRow + 1 : 0,
  };
}

/** Object id -> shade index within its type (the thesis' saturation coding). */
export function objectShades(objectsByType: Record<string, string[]>): Record<string, number> {
  const shades: Record<string, number> = {};
  for (const objs of Object.values(objectsByType)) {
    [...objs].sort().forEach((obj, index) => {
      shades[obj] = index;
    });
  }
  return shades;
}
