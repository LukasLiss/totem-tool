import { useMemo, useState } from "react";
import { Minus, Plus, Scan } from "lucide-react";

import type { OCAlignmentMove } from "@/api/ocAlignmentApi";
import { Button } from "@/components/ui/button";
import { mapTypesToColors } from "@/utils/objectColors";

import {
  MOVE_STYLES,
  NODE_HALF_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
  layoutAlignment,
  objectShades,
  visibleAlignment,
  type LaidOutNode,
} from "./layout";

const SHADE_ALPHA = [1, 0.7, 0.5, 0.35];
const EDGE_COLOR = "#64748B";
const ARROW_LENGTH = 9;
const ARROW_HALF_WIDTH = 4.5;

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

function chipStyle(color: string, shade: number): React.CSSProperties {
  const [r, g, b] = hexToRgb(color);
  const alpha = SHADE_ALPHA[shade % SHADE_ALPHA.length];
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${alpha})`,
    color: alpha >= 0.7 ? "#FFFFFF" : "#0F172A",
    borderColor: color,
  };
}

export interface AlignmentGraphProps {
  moves: OCAlignmentMove[];
  objectsByType: Record<string, string[]>;
  showSilentMoves: boolean;
  /** Height of the graph block; "fill" grows with a flex parent. */
  height?: number | "fill";
}

function ObjectChips({
  objects,
  colors,
  shades,
}: {
  objects: Record<string, string[]>;
  colors: Record<string, string>;
  shades: Record<string, number>;
}) {
  const entries = Object.entries(objects).flatMap(([type, ids]) => ids.map((id) => ({ type, id })));
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-0.5 overflow-hidden" style={{ maxHeight: 20 }}>
      {entries.map(({ type, id }) => (
        <span
          key={`${type}:${id}`}
          title={`${id} (${type})`}
          className="max-w-[80px] truncate rounded-sm border px-1 text-[10px] leading-4"
          style={chipStyle(colors[type] ?? "#94A3B8", shades[id] ?? 0)}
        >
          {id}
        </span>
      ))}
    </div>
  );
}

function MoveBox({
  node,
  colors,
  shades,
}: {
  node: LaidOutNode;
  colors: Record<string, string>;
  shades: Record<string, number>;
}) {
  const { move } = node;
  const style = MOVE_STYLES[move.kind];
  const hasLog = move.kind !== "model";
  const hasModel = move.kind !== "log";
  const modelLabel = move.silent ? "τ (silent)" : move.model_activity ?? "";
  const tooltip = [
    style.label + (move.silent ? " (silent)" : ""),
    hasLog ? `Log: ${move.log_activity} [event ${move.event_id}]` : "Log: ≫",
    hasModel ? `Model: ${modelLabel} [transition ${move.transition_id}]` : "Model: ≫",
    `Cost: ${move.silent ? "ε" : move.cost}`,
  ].join("\n");
  return (
    <div
      data-testid="oc-alignment-move"
      data-kind={move.kind}
      title={tooltip}
      className="absolute flex flex-col overflow-hidden rounded-md text-left shadow-sm"
      style={{
        left: node.x,
        top: node.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        border: `2px ${style.border} ${style.color}`,
        backgroundColor: style.fill,
        opacity: move.silent ? 0.75 : 1,
      }}
    >
      <div className="flex flex-1 flex-col justify-between px-2 py-1" style={{ height: NODE_HALF_HEIGHT }}>
        <span className={`truncate text-xs font-medium ${hasLog ? "text-slate-900" : "text-slate-400"}`}>
          {hasLog ? move.log_activity : "≫"}
        </span>
        {hasLog ? <ObjectChips objects={move.log_objects} colors={colors} shades={shades} /> : null}
      </div>
      <div
        className="flex flex-1 flex-col justify-between px-2 py-1"
        style={{ height: NODE_HALF_HEIGHT, borderTop: `1px ${style.border} ${style.color}` }}
      >
        <span
          className={`truncate text-xs font-medium ${
            hasModel ? (move.silent ? "italic text-slate-500" : "text-slate-900") : "text-slate-400"
          }`}
        >
          {hasModel ? modelLabel : "≫"}
        </span>
        {hasModel ? <ObjectChips objects={move.model_objects} colors={colors} shades={shades} /> : null}
      </div>
    </div>
  );
}

export function AlignmentLegend({ colors }: { colors: Record<string, string> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {(Object.keys(MOVE_STYLES) as (keyof typeof MOVE_STYLES)[]).map((kind) => (
        <span key={kind} className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-5 rounded-sm"
            style={{
              border: `2px ${MOVE_STYLES[kind].border} ${MOVE_STYLES[kind].color}`,
              backgroundColor: MOVE_STYLES[kind].fill,
            }}
          />
          {MOVE_STYLES[kind].label}
        </span>
      ))}
      <span className="text-muted-foreground/60">|</span>
      {Object.entries(colors).map(([type, color]) => (
        <span key={type} className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm" style={{ backgroundColor: color }} />
          {type}
        </span>
      ))}
      <span className="text-muted-foreground/80">
        Upper half: log (de-facto) · lower half: model (de-jure) · ≫ = no move
      </span>
    </div>
  );
}

/**
 * The alignment as a directed acyclic graph of moves. Edges connect moves
 * that share an object; the layout reads left (start) to right (end).
 */
export function AlignmentGraph({ moves, objectsByType, showSilentMoves, height = 420 }: AlignmentGraphProps) {
  const [zoom, setZoom] = useState(1);
  const colors = useMemo(() => mapTypesToColors(Object.keys(objectsByType)), [objectsByType]);
  const shades = useMemo(() => objectShades(objectsByType), [objectsByType]);
  const layout = useMemo(() => {
    const visible = visibleAlignment(moves, showSilentMoves);
    return layoutAlignment(visible.moves, visible.edges);
  }, [moves, showSilentMoves]);

  if (layout.nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">The alignment has no moves to show.</p>;
  }

  return (
    <div
      className={`relative flex min-h-0 flex-col gap-2 ${height === "fill" ? "flex-1" : ""}`}
      style={height === "fill" ? { minHeight: 260 } : { height }}
    >
      <div className="absolute right-2 top-2 z-10 flex gap-1 rounded-md border bg-background/90 p-0.5 shadow-sm">
        <Button size="icon" variant="ghost" className="size-7" aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.15).toFixed(2)))}>
          <Minus />
        </Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label="Reset zoom" onClick={() => setZoom(1)}>
          <Scan />
        </Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(2, +(z + 0.15).toFixed(2)))}>
          <Plus />
        </Button>
      </div>
      <div
        data-testid="oc-alignment-graph"
        className="min-h-0 flex-1 overflow-auto rounded-md border bg-white"
      >
        <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div
            className="relative origin-top-left"
            style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}
          >
            <svg className="pointer-events-none absolute inset-0" width={layout.width} height={layout.height}>
              {layout.edges.map(({ from, to }) => {
                // The curve stops where the arrowhead starts and arrives
                // horizontally, so line and head form one continuous stroke.
                const x1 = from.x + NODE_WIDTH;
                const y1 = from.y + NODE_HALF_HEIGHT;
                const xEnd = to.x - ARROW_LENGTH;
                const y2 = to.y + NODE_HALF_HEIGHT;
                const dx = Math.max(16, (xEnd - x1) / 2);
                return (
                  <path
                    key={`${from.position}-${to.position}`}
                    d={`M${x1},${y1} C${x1 + dx},${y1} ${xEnd - dx},${y2} ${xEnd},${y2}`}
                    fill="none"
                    stroke={EDGE_COLOR}
                    strokeWidth={1.5}
                    strokeLinecap="butt"
                  />
                );
              })}
              {/* One head per target: edges into the same move share it. */}
              {[...new Map(layout.edges.map(({ to }) => [to.position, to])).values()].map((to) => {
                const tipX = to.x;
                const y = to.y + NODE_HALF_HEIGHT;
                return (
                  <path
                    key={`head-${to.position}`}
                    data-testid="oc-alignment-arrowhead"
                    d={`M${tipX - ARROW_LENGTH},${y - ARROW_HALF_WIDTH} L${tipX},${y} L${tipX - ARROW_LENGTH},${y + ARROW_HALF_WIDTH} Z`}
                    fill={EDGE_COLOR}
                  />
                );
              })}
            </svg>
            {layout.nodes.map((node) => (
              <MoveBox key={node.position} node={node} colors={colors} shades={shades} />
            ))}
          </div>
        </div>
      </div>
      <AlignmentLegend colors={colors} />
    </div>
  );
}
