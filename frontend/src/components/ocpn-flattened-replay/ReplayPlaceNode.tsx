import { memo } from "react";
import { type Node, type NodeProps } from "@xyflow/react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { OcpnReplayPlaceStats } from "@/api/ocpnFlattenedReplayApi";
import {
  NodeHandles,
  PlayGlyph,
  SOFT_SHADOW,
  SquareGlyph,
} from "@/editors/shared/node-chrome";
import { PLACE_SIZE, type PlaceNodeData } from "@/editors/ocpn/types";

import {
  formatPercent,
  highlightIntensity,
  highlightShadow,
} from "./replayPresentation";

export type ReplayPlaceNodeData = PlaceNodeData & {
  stats?: OcpnReplayPlaceStats;
};

export type ReplayPlaceFlowNode = Node<ReplayPlaceNodeData, "place">;

function StatRow({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span className={`font-mono tabular-nums ${tone ?? ""}`}>{value.toLocaleString()}</span>
    </div>
  );
}

/**
 * A place of the replayed OCPN: the editor's place glyph plus a red halo
 * whose strength follows the place's deviation, small "−missing / +remaining"
 * badges, and a tooltip with the token counts.
 */
export const ReplayPlaceNode = memo(function ReplayPlaceNode({
  id,
  data,
}: NodeProps<ReplayPlaceFlowNode>) {
  const stats = data.stats;
  const intensity = highlightIntensity(stats);
  const halo = highlightShadow(intensity);
  const marked = data.initial || data.final;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-testid={`replay-place-${id}`}
          data-intensity={intensity.toFixed(2)}
          style={{ position: "relative", width: PLACE_SIZE, height: PLACE_SIZE }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: `2.5px solid ${data.color}`,
              background: marked ? data.color : "#FFFFFF",
              boxShadow: halo ? `${halo}, ${SOFT_SHADOW}` : SOFT_SHADOW,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
            }}
          >
            {data.initial && data.final ? (
              <>
                <PlayGlyph size={11} />
                <SquareGlyph size={10} />
              </>
            ) : data.initial ? (
              <PlayGlyph size={16} />
            ) : data.final ? (
              <SquareGlyph size={15} />
            ) : null}
          </div>
          <NodeHandles show={false} />
          <div
            style={{
              position: "absolute",
              top: PLACE_SIZE + 6,
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              gap: 4,
              fontSize: 10,
              fontWeight: 600,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {stats && stats.missing > 0 && (
              <span style={{ color: "#B91C1C" }}>−{stats.missing.toLocaleString()}</span>
            )}
            {stats && stats.remaining > 0 && (
              <span style={{ color: "#B45309" }}>+{stats.remaining.toLocaleString()}</span>
            )}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="min-w-44">
        <div className="space-y-0.5">
          <div className="font-semibold">
            Place {id} · {data.objectType}
          </div>
          {stats ? (
            <>
              <StatRow label="Produced" value={stats.produced} />
              <StatRow label="Consumed" value={stats.consumed} />
              <StatRow label="Missing" value={stats.missing} tone={stats.missing ? "text-red-300" : undefined} />
              <StatRow label="Remaining" value={stats.remaining} tone={stats.remaining ? "text-amber-300" : undefined} />
              <div className="flex justify-between gap-4 pt-0.5 opacity-80">
                <span>Deviation</span>
                <span className="font-mono tabular-nums">{formatPercent(stats.deviation)}</span>
              </div>
            </>
          ) : (
            <div className="opacity-80">No replay data</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
});
